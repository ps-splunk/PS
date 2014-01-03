#!/usr/bin/env python

import csv
import logging
import logging.handlers
import os
import sys
import time
import calendar
import splunk.clilib.cli_common
import pymysql, pymysql.cursors


from sforce.enterprise import SforceEnterpriseClient
from xml.etree.ElementTree import ElementTree

class ResultsParser(object):
    def __init__(self):
        self.messages = []
        self.timeseed = None
	self.values = {}

    def parse(self,results):
        if results.size == 0:
            return None
        for record in results.records:
            message = []
	    values = {}

            ts = None
            description = None
            for r in record:
		# TODO: This should not be hardcoded.
                if r[0].startswith(settings["timestamp"]) or r[0].startswith("LoginTime"):
                    ts = str(r[1])
                    message.insert(0,ts)
                    seed = soql_format('g2etime', str(r[1]), '%Y-%m-%d %H:%M:%S')

                    if not self.timeseed:
                        self.timeseed = seed
                    else:
                        if self.timeseed < seed:
                            self.timeseed = seed

		    values[unicode(r[0])] = unicode(r[1])

		elif r[0].startswith("Id"):
		    message.append('='.join([unicode(r[0]), unicode(r[1])]))
		    values[unicode(r[0])] = unicode(r[1])
                else:
		    edits = [('\n', ' '), ('\r', ' '), ('=', '--'), ('"', '\'')]

		    val = unicode(r[1])

		    for search, replace in edits:
			val = val.replace(search, replace)

		    if val.find(' ') > -1:
			val = '"' + val + '"'
			
                    message.append('='.join([unicode(r[0]), val]))
		    values[unicode(r[0])] = val

		if values.has_key("Id"):
		    self.values[values["Id"]] = values

            self.messages.append(" ".join(message))

	if not self.timeseed:
	    self.timeseed = 864000

	self.timeseed += 1

        return self.timeseed

def soql_format(type=None,value=None,format=None):
    '''convenience method to convert to/from SOQL formats'''
    if not type or not value:
        raise
    try:
        if type.startswith('e2gtime'):
            t = time.gmtime(float(value))
            u = []
            u.append(str(t[0]))
            for x in range(1,6):
                if t[x]>=0 and t[x]<10:
                    u.append('0' + str(t[x]))
                else:
                    u.append(str(t[x]))
            return u[0] + '-' + u[1] + '-' + u[2] + 'T' + u[3] + ':' + u[4] + ':' + u[5] + '-08:00'
        elif type.startswith('g2etime'):
            if not format:
                format = '%Y-%m-%dT%H:%M:%S'
            return calendar.timegm(time.strptime(value,format))
        else:
            raise NotImplementedError
    except:
        raise

def splkbool( dkey="" ):
    if dkey == "true":
	return 1
    if dkey == "True":
	return 1
    if dkey == "1":
	return 1

    return 0

def sfdcDataType( sDT ):
    if sDT == "xsd:boolean":
	return "VARCHAR(5)"
    if sDT == "xsd:string":
	return "VARCHAR(255)"
    if sDT == "xsd:double":
	return "FLOAT"
    if sDT == "tns:ID":
	return "VARCHAR(25)"
    if sDT == "xsd:dateTime":
	return "DATETIME"
    if sDT == "xsd:date":
	return "DATETIME"
    if sDT == "xsd:time":
	return "DATETIME"

    return "VARCHAR(255)"

if __name__ == '__main__':
    settings = splunk.clilib.cli_common.getConfStanza(os.path.join(sys.path[0], "..", "local", "sfdc"), "sfdc")
    lastTime = {}
    seedFile = os.path.join(sys.path[0], '.sfdc2df.seed')

    if not os.path.exists(settings["log_path"]):
	os.makedirs(settings["log_path"])

    flogger = logging.getLogger('splunkx_sfdc')
    flogger.setLevel(logging.DEBUG)
    handler = logging.handlers.RotatingFileHandler("/".join([settings["log_path"], 'splunkx_sfdc']), maxBytes=52428800, backupCount=5)
    g = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
    handler.setFormatter(g)
    handler.setLevel(logging.INFO)
    flogger.addHandler(handler)
    conn = None
    args = {}

    if settings.has_key("use_db"):
	useDB = splkbool(settings['use_db'])
	args['password'] = settings['db_pass']
	args['host'] = settings['db_server']
	args['username'] = settings['db_user']
	args['port'] = settings['db_port']
	args['schema'] = settings['db_db']

	try:
	    flogger.info("MySQL lookups enabled. Instantiating connection to MySQL server.")

	    conn = pymysql.connect (host   = args['host'],
		port   = int(args['port']),
		user   = args['username'],
		passwd = args['password'],
		db     = args['schema'],
		charset = 'utf8' )

	    conn.autocommit(True)
	except:
	    flogger.info("Error connecting to database and MySQL lookups are enabled. Halting.")
	    raise

	cursor = conn.cursor(pymysql.cursors.DictCursor)

	try:
		cursor.execute("DESCRIBE timeseed")
	except:
		try:
		    cursor.execute("CREATE TABLE timeseed(object VARCHAR(150) NOT NULL PRIMARY KEY, lastrun INT)")
		except:
		    flogger.info("MySQL lookups failure: cannot read/create timeseed table.")
	cursor.close()

	cursor = conn.cursor(pymysql.cursors.DictCursor)

	try:
		cursor.execute("SELECT * FROM timeseed")
		timeseeds = cursor.fetchall()

		for k in timeseeds:
		    lastTime[k['object']] = k['lastrun']

	except:
		flogger.info("MySQL lookup failure: cannot read timeseed information")

	cursor.close()

    else:
	useDB = 0

    i = 0
    j = 0
    k = 0

    stables = []
    goodtypes = []
    query = []
    tables = []

    while True:
	try:
	    objkey = "sfdc_object." + str(i)
	    stables.append(settings[objkey])
	except:
	    break

	i += 1

    while True:
	try:
	    typkey = "sfdc_types." + str(j)
	    goodtypes.append(settings[typkey])
	except:
	    break

	j += 1

    if not useDB:
	try:
	    sf = csv.reader(open(seedFile,'rb'))

	    for row in sf:
		lastTime[row[0]] = row[1]

	except IOError:
	    for row in stables:
		lastTime[row] = 864000

	flogger.info("Error opening seedfile.  Might be first time run.")

    xml = open(os.path.join(sys.path[0], "..", "local", settings["wsdl"]),"r")
    tree = ElementTree()

    try:
	tree.parse(xml)
    except:
	raise

    xml.close()
    t = tree.getroot()

    types = tree.find("{http://schemas.xmlsoap.org/wsdl/}types")

    for s in types:
	if s.get("targetNamespace") == "urn:sobject.enterprise.soap.sforce.com":
	    elements = s.findall("{http://www.w3.org/2001/XMLSchema}complexType")

	    transforms = ""

	    for o in elements:
		if o.get("name") in stables:
		    sequence = o.find("{http://www.w3.org/2001/XMLSchema}complexContent/{http://www.w3.org/2001/XMLSchema}extension/{http://www.w3.org/2001/XMLSchema}sequence")
		    fields = sequence.findall("{http://www.w3.org/2001/XMLSchema}element")

		    tmpcol = ["Id"]
		    collist = ""

		    dbfields = {}

		    for f in fields:
			if f.get("type") in goodtypes:
			    tmpcol.append(f.get("name"))
			    dbfields[f.get("name")] = f.get("type")

		    collist = ", ".join(tmpcol)

		    if useDB:
			# Check this schema against the database schema.
			dbc = conn.cursor(pymysql.cursors.DictCursor)

			try:
				dbc.execute("DESCRIBE sfdc_"+o.get("name"))
				hasdbf = dbc.fetchall()

				iscols = {}

				for col in hasdbf:
				    iscols[col['Field']] = 1

				addcols = {}
				xcols = []

				for f in fields:
				    if f.get("type") in goodtypes:
					xcols.append(f.get("name"))
					if not iscols.has_key(f.get("name")):
					    addcols[f.get("name")] = f.get("type") 

				if addcols:
				    sqlish = ""
				    colsadd = []

				    for n, t in addcols.iteritems():
					colsadd.append(n+" "+sfdcDataType(t))

				    sqlish = ", ".join(colsadd)

				    try:
					dbc.execute("ALTER TABLE sfdc_"+o.get("name")+" ADD ("+sqlish+")")
				    except:
					flogger.info("MySQL lookup failure: Unable to update database object for %s", o.get("name"))
					raise

				transforms = transforms+"[sfdc_"+o.get("name").lower()+"]\n"
				transforms = transforms+"external_cmd = dblookup_mysql.py username=\""+settings['db_user']+"\" password=\""+settings['db_pass']+"\" host=\""+settings['db_server']+"\" port=\""+settings['db_port']+"\" schema=\""+settings['db_db']+"\" table=\"sfdc_"+o.get("name")+"\"\n"
				transforms = transforms+"fields_list = Id, "+", ".join(xcols)+"\n\n"

			except:
				sqlish = "Id VARCHAR(25) NOT NULL PRIMARY KEY"
				xcols = []

				for n, t in dbfields.iteritems():
				    xcols.append(n)
				    coldef = n+" "+sfdcDataType(t)
				    sqlish = sqlish+", "+coldef

				try:
					dbc.execute("CREATE TABLE sfdc_"+o.get("name")+" ("+sqlish+")")
				except:
					flogger.info("MySQL lookup failure: Unable to create database object for %s", o.get("name"))
					raise

				transforms = transforms+"[sfdc_"+o.get("name").lower()+"]\n"
				transforms = transforms+"external_cmd = dblookup_mysql.py username=\""+settings['db_user']+"\" password=\""+settings['db_pass']+"\" host=\""+settings['db_server']+"\" port=\""+settings['db_port']+"\" schema=\""+settings['db_db']+"\" table=\"sfdc_"+o.get("name")+"\"\n"
				transforms = transforms+"fields_list = Id, "+", ".join(xcols)+"\n\n"

			dbc.close()
			f = open(os.path.join(sys.path[0], "..", "local", "transforms.conf"), 'w+')
			f.write(transforms)
			f.close()

		    # Check to see if we have per-object settings
		    timefield = settings["timestamp"]
		    limitfield = ""

		    try:
			oset = splunk.clilib.cli_common.getConfStanza(os.path.join(sys.path[0], "..", "local", "sfdc"), "sfdc_"+o.get("name"))

			if "timefield" in oset:
			    timefield = oset["timefield"]

			if "limit" in oset:
			    limitfield = " LIMIT " + oset["limit"]
		    except:
			pass

		    if not o.get("name") in lastTime:
			lastTime[o.get("name")] = 864000

		    qry = "SELECT " + collist + " FROM " + o.get("name") + " WHERE " + timefield + " >= " + soql_format('e2gtime', lastTime[o.get("name")] ) + " ORDER BY " + timefield + limitfield

                    query.insert(k, qry)
		    tables.insert(k, o.get("name") )

		    k += 1

    flogger.info("Instantiating connection to SFDC API")

    h = SforceEnterpriseClient(os.path.join(sys.path[0], '..', 'local', settings["wsdl"] ))
    h.login(settings["username"], settings["password"], settings["token"])

    flogger.info("Instantiating per-object log files")

    f = {}

    for q in tables:
        f[q] = logging.getLogger(q)
        f[q].setLevel(logging.DEBUG)
        handler = logging.handlers.RotatingFileHandler("/".join([settings["log_path"], q]), maxBytes=52428800, backupCount=20)
        g = logging.Formatter("%(message)s")
        handler.setFormatter(g)
        handler.setLevel(logging.INFO)
        f[q].addHandler(handler)

    try:
        for id, q in enumerate(tables):
            m_size = 0
            results = ResultsParser()
            flogger.info("Submitting query for object %s at time %s",
                          q, soql_format('e2gtime', lastTime[q] ) )
            flogger.debug("Query: %s", query[id])
            qr = h.queryAll(query[id])
            tsd = results.parse(qr)

            if not tsd:
                flogger.info("Received no results from query for object %s", q)
            else:
		# Check to see if the db object exists
		maketable = 1

		try:
		    qset = splunk.clilib.cli_common.getConfStanza(os.path.join(sys.path[0], "..", "local", "sfdc"), "sfdc_"+q)
		    maketable = splkbool(qset["maketable"])
		except:
		    pass

		if useDB and maketable:
		    dbic = conn.cursor()

		    for k, v in results.values.iteritems():
			colupdate = []
			valupdate = []

			for k1, v1 in v.iteritems():
			    colupdate.append(unicode(k1))
			    valupdate.append(conn.escape(unicode(str(v1))))

			colupd = ", ".join(colupdate)
			valupd = ", ".join(valupdate)

			dbic.execute("REPLACE INTO sfdc_"+unicode(q)+" ("+unicode(colupd)+") VALUES("+unicode(valupd)+")") 

		    dbic.close()

                for m in results.messages:
                    f[q].info(m)
                    m_size = m_size + len(m)

                flogger.info("Processed %s results from SFDC for object %s, size %d bytes", qr.size, q, m_size)

		lastTime[q] = tsd
    except:
        raise

    if not useDB:
	sf = csv.writer(open(seedFile,'wb'))

	for k,v in lastTime.iteritems():
	    sf.writerow([k,v])
    else:
	cursor = conn.cursor()

	for k,v in lastTime.iteritems():
	    cursor.execute("REPLACE INTO timeseed( object, lastrun ) VALUES( '"+k+"', "+str(v)+")")

	cursor.close()
	conn.close()
