require.config({
    paths: {
        "app": "../app"
    }
});

require([
    'jquery',
    'underscore',
    'splunkjs/mvc',
    'splunkjs/mvc/multiselectview',
    'splunkjs/mvc/searchmanager',
    'views/shared/results_table/renderers/BaseCellRenderer',
    'splunkjs/mvc/simplexml/ready!',
    'app/PS/components/sunburst/sunburst'
], function(
    $,
    _,
    mvc,
    MultiSelectView,
    SearchManager,
    BaseCellRenderer,
    SimpleSplunkView,
    Sunburst
) {

    function submit_and_update_url() {
        SubmittedTokens.set(UnsubmittedTokens.toJSON());
        mvc.Components.get('url').saveOnlyWithPrefix('form\\.', UnsubmittedTokens.toJSON(), {
            replaceState: false
        });
    }

    function mv_selector(mv_id, ts_var, mv_container_id, label, value, manager_id, search) {
        var MultiSelect = new MultiSelectView({
            id: mv_id,
            value: "$submitted:"+ ts_var + "$",
            el: $(mv_container_id),
            labelField: label,
            valueField: value,
            managerid: manager_id
        }, {tokens: true}).render();

        var MultiSearch = new SearchManager({
            id: manager_id,
            search: search,
        }, {tokens: true});
    }

    function ts_submitted_token_on_change(ts_field, ts_field_query, field_name) {
        SubmittedTokens.on('change:' + ts_field, function(submitted, value) {
            value = value || [];
            if(value.length === 0) {
                value.unshift("\""+field_name+"\"=*");
            }

            UnsubmittedTokens.set(ts_field_query, value.join(" OR "));
            submit_and_update_url();
        });
    }

    function create_paginator_placeholders() {
        var results = $("#transaction_search div.panel-body div.splunk-table");

        var paginator = $(results).find("div.splunk-paginator");
        var results_table = $(results).find("div.shared-resultstable-resultstablemaster");

        $(results_table).css('clear', 'both');
        $(paginator).css('clear', 'both');
        $(results_table).before($(paginator));

        if($(results).find("#ts_restricted_remaining").length === 0) {
            var placeholder = '<span id="ts_filtered_remaining"></span>';
            placeholder += ' - <span id="ts_restricted_remaining"></span>';
            placeholder += ' - <span id="ts_min_remaining"></span>';
            placeholder += ' - <span id="ts_max_remaining"></span>';
            placeholder += ' - <span id="ts_min_start_date"></span>';
            placeholder += ' - <span id="ts_max_start_date"></span>';
            placeholder += ' - <span id="ts_count"></span>';
            placeholder += ' - <span id="ts_restricted_out"></span>';
            placeholder += ' - <span id="ts_filtered_out"></span>';

            placeholder = '<div style="float: right; padding-right: 20px;">' + placeholder + '</div>';

            $(paginator).before(placeholder);
        }
    }

    function display_ts_count_info() {
        if(
            typeof ts_count === 'undefined'||
            typeof total_count === 'undefined' ||
            typeof ts_restricted_count === 'undefined'
        ) {
            return;
        }

        var ts_restricted_out = total_count - ts_restricted_count;
        var ts_filtered_out = ts_restricted_count - ts_count;

        $("#ts_count").text(ts_count + (ts_count === 1 ? " result" : " results"));
        $("#ts_restricted_out").text(ts_restricted_out + (ts_restricted_out === 1 ? " result" : " results") + " restricted out");
        $("#ts_filtered_out").text(ts_filtered_out + (ts_filtered_out === 1 ? " result" : " results") + " filtered out");

        if(ts_count === 0) {
            $("#ts_filtered_remaining").text("Total: N/A");
            $("#ts_restricted_remaining").text("Restricted Total: N/A");
            $("#ts_min_remaining").text("Min: N/A");
            $("#ts_max_remaining").text("Max: N/A");
            $("#ts_min_start_date").text("Earliest: N/A");
            $("#ts_max_start_date").text("Latest: N/A");
        }
    }

    $("#debug").parents("div.dashboard-row").hide();
    $("#field7").find("abbr").remove();
    $("#transaction_search div.panel-head").after('<div class="fieldset">').after('<div class="fieldset">');
    $("#transaction_search div.fieldset:eq(1)").append($("#field8, #field9, #field10, #field11, #field12"));
    $("#ts_other_inputs div[id^=mv_]").each(function() {
        var input_div = $(this).parent();
        $(input_div).addClass("input splunk-view");
        $("#transaction_search div.fieldset:eq(0)").append(input_div);
    });

    $("#transaction_search div.fieldset:eq(0)").prepend('<h5 style="margin-left: 10px;">Restricted: <button id="clear_restricted">Clear</button></h5>');
    $("#transaction_search div.fieldset:eq(1)").prepend('<h5 style="margin-left: 10px;">Filtered: <button id="clear_filtered">Clear</button></h5>');

    $("#clear_restricted").click(function() {
        $.each(["mv_name", "mv_sales_rep", "mv_sales_theater", "mv_sub_theater", "mv_sales_district", "mv_sub_district"], function(index, element) {
            mvc.Components.get(element).val([]);
        });
    });

    $("#clear_filtered").click(function() {
        $("#field8, #field9, #field10, #field11, #field12").each(function() {
            $(this).find("input").val("");
        });

        $.each(['ts_name_wildcard', 'ts_from_start_date', 'ts_to_start_date', 'ts_min_remaining', 'ts_max_remaining'], function(index, element) {
            UnsubmittedTokens.set(element, default_token_values[element]);
        });

        submit_and_update_url();
    });

    $("#field9 input").datepicker({
        changeYear: true,
        changeMonth: true,
        dateFormat: $.datepicker.W3C,
        onClose: function(date_text) {
            $("#field10 input").datepicker("option", "minDate", date_text);
        }
    });

    $("#field10 input").datepicker({
        changeYear: true,
        changeMonth: true,
        dateFormat: $.datepicker.W3C,
        onClose: function(date_text) {
            $("#field9 input").datepicker("option", "maxDate", date_text);
        }
    });

    $("#ts_other_inputs").parents("div.dashboard-row").remove();

    var sfdc_link = 'https://splunk.my.salesforce.com/';

    var TransactionSearchView = mvc.Components.get('transaction_search');
    var MonthToMonthView = mvc.Components.get('month_to_month');
    var MonthToMonthDetailView = mvc.Components.get('month_to_month_detail');

    var UnsubmittedTokens = mvc.Components.get('default');
    var SubmittedTokens = mvc.Components.get('submitted');

    var TotalBacklogCountSearch = mvc.Components.getInstance('search2');
    var TransactionSearch = mvc.Components.getInstance('search3');

    var mv_name_search = '| `backlog_sanitization(backlog.0, $months_ago$)` | search ($ts_sales_rep_query$) ($ts_sales_theater_query$) ($ts_sub_theater_query$) ($ts_sales_district_query$) ($ts_sub_district_query$) | table Name | eval value="Name=\\""+Name+"\\"" | sort Name';
    var mv_sales_rep_search = '| `backlog_sanitization(backlog.0, $months_ago$)` | search ($ts_sales_theater_query$) ($ts_sub_theater_query$) ($ts_sales_district_query$) ($ts_sub_district_query$) ($ts_name_query$) | stats BY "Sales Rep" | table "Sales Rep" | eval value="\\"Sales Rep\\"=\\""+\'Sales Rep\'+"\\"" | sort "Sales Rep"';
    var mv_sales_theater_search = '| `backlog_sanitization(backlog.0, $months_ago$)` | search ($ts_sales_rep_query$) ($ts_sub_theater_query$) ($ts_sales_district_query$) ($ts_sub_district_query$) ($ts_name_query$) | stats BY "Sales Theater" | table "Sales Theater" | eval value="\\"Sales Theater\\"=\\""+\'Sales Theater\'+"\\""';
    var mv_sub_theater_search = '| `backlog_sanitization(backlog.0, $months_ago$)` | search ($ts_sales_rep_query$) ($ts_sales_theater_query$) ($ts_sales_district_query$) ($ts_sub_district_query$) ($ts_name_query$) | stats BY "Sales Theater" "Sub-Theater" | eval label=\'Sales Theater\'+" - "+\'Sub-Theater\' | eval value="\\"Sales Theater\\"=\\""+\'Sales Theater\'+"\\" \\"Sub-Theater\\"=\\""+\'Sub-Theater\'+"\\"" | table label value';
    var mv_sales_district_search = '| `backlog_sanitization(backlog.0, $months_ago$)` | search ($ts_sales_rep_query$) ($ts_sales_theater_query$) ($ts_sub_theater_query$) ($ts_sub_district_query$) ($ts_name_query$) | stats BY "Sales Theater" "Sub-Theater" "Sales District" | eval label=\'Sales Theater\'+" - "+\'Sub-Theater\'+" - "+\'Sales District\' | eval value="\\"Sales Theater\\"=\\""+\'Sales Theater\'+"\\" \\"Sub-Theater\\"=\\""+\'Sub-Theater\'+"\\" \\"Sales District\\"=\\""+\'Sales District\'+"\\"" | table label value';
    var mv_sub_district_search = '| `backlog_sanitization(backlog.0, $months_ago$)` | search ($ts_sales_rep_query$) ($ts_sales_theater_query$) ($ts_sub_theater_query$) ($ts_sales_district_query$) ($ts_name_query$) | stats BY "Sales Theater" "Sub-Theater" "Sales District" "Sub-District" | eval label=\'Sales Theater\'+" - "+\'Sub-Theater\'+" - "+\'Sales District\'+" - "+\'Sub-District\'| eval value="\\"Sales Theater\\"=\\""+\'Sales Theater\'+"\\" \\"Sub-Theater\\"=\\""+\'Sub-Theater\'+"\\" \\"Sales District\\"=\\""+\'Sales District\'+"\\" \\"Sub-District\\"=\\""+\'Sub-District\'+"\\"" | table label value';

    mv_selector("mv_name", "ts_name", "#mv_name_container", "Name", "value", "MultiSearchName", mv_name_search);
    mv_selector("mv_sales_rep", "ts_sales_rep", "#mv_sales_rep_container", "Sales Rep", "value", "MultiSearchSalesRep", mv_sales_rep_search);
    mv_selector("mv_sales_theater", "ts_sales_theater", "#mv_sales_theater_container", "Sales Theater", "value", "MultiSearchSalesTheater", mv_sales_theater_search);
    mv_selector("mv_sub_theater", "ts_sub_theater", "#mv_sub_theater_container", "label", "value", "MultiSearchSubTheater", mv_sub_theater_search);
    mv_selector("mv_sales_district", "ts_sales_district", "#mv_sales_district_container", "label", "value", "MultiSearchSalesDistrict", mv_sales_district_search);
    mv_selector("mv_sub_district", "ts_sub_district", "#mv_sub_district_container", "label", "value", "MultiSearchSubDistrict", mv_sub_district_search);

    var sunburst_fields = ['"Sales Theater"', '"Sub-Theater"', '"Sales District"', '"Sub-District"'];

    var sunburst_search = '| `backlog_sanitization(backlog.0, $months_ago$)` | stats sum(Remaining) AS Remaining BY ' + sunburst_fields.join(" ") + ' | rename "Sales Theater" AS sales_theater "Sub-Theater" AS sub_theater "Sales District" AS sales_district "Sub-District" AS sub_district';
    //var sunburst_search = '| `backlog_sanitization(backlog.0, $months_ago$)` | stats sum(Remaining) AS Remaining BY "Sales Theater" "Sub-Theater" "Sales District" "Sub-District"';

    var SunburstSearch = new SearchManager({
        id: "sunburst_search",
        search: sunburst_search
    }, {tokens: true});

    var SunburstChart = new Sunburst({
        id: 'sunburst_chart',
        managerid: 'sunburst_search',
        el: $('#sunburst'),
        //categoryFields: ["Sales Theater", "Sub-Theater", "Sales District", "Sub-District"],
        categoryFields: "sales_theater sub_theater sales_district sub_district",
        formatTooltip: function(d) {
            return "$"+d.value.toFixed(2).replace(/(\d)(?=(\d{3})+\.)/g, '$1,').replace(/\.00/, '');
        },
        valueField: 'Remaining'
    }).render();

    var ts_info_search = '| `backlog_sanitization(backlog.0, $months_ago$)` | search ($ts_sales_rep_query$) ($ts_sales_theater_query$) ($ts_sub_theater_query$) ($ts_sales_district_query$) ($ts_sub_district_query$) ($ts_name_query$) | stats count sum(Remaining) AS Total_Remaining min(Remaining) AS Min_Remaining max(Remaining) AS Max_Remaining min("Start Date") AS Min_Start_Date max("Start Date") AS Max_Start_Date | append [| `backlog_sanitization(backlog.0, $months_ago$)` | where \'Start Date\'>="$ts_from_start_date$" AND \'Start Date\'<="$ts_to_start_date$" AND Remaining>=$ts_min_remaining$ AND Remaining<=$ts_max_remaining$ | search ($ts_sales_rep_query$) ($ts_sales_theater_query$) ($ts_sub_theater_query$) ($ts_sales_district_query$) ($ts_sub_district_query$) ($ts_name_query$) Name="$ts_name_wildcard$" | stats count sum(Remaining) as Total_Remaining] | foreach *_Remaining [fieldformat <<FIELD>>="$"+tostring(<<FIELD>>, "commas")]';
    var ts_date_range_search = '| `backlog_sanitization(backlog.0, $months_ago$)` | stats min("Start Date") AS min_start_date max("Start Date") AS max_start_date';

    var TotalBacklogCountResults = TotalBacklogCountSearch.data('results', {count: 1});

    var total_count;
    var ts_restricted_count;
    var ts_count;

    TotalBacklogCountResults.on('data', function() {
        total_count = parseInt(this.data().rows[0][0], 10);

        display_ts_count_info();
    });

    TransactionSearch.on('search:start', function(properties) {
        create_paginator_placeholders();

        $("#ts_filtered_remaining").text("Loading...");
        $("#ts_restricted_remaining").text("Loading...");
        $("#ts_min_remaining").text("Loading...");
        $("#ts_max_remaining").text("Loading...");
        $("#ts_min_start_date").text("Loading...");
        $("#ts_max_start_date").text("Loading...");
        $("#ts_count").text("Loading...");
        $("#ts_restricted_out").text("Loading...");
        $("#ts_filtered_out").text("Loading...");
    });

    TransactionSearch.on('search:done', function(properties) {
        create_paginator_placeholders();

        ts_count = this.attributes.data.resultCount;

        display_ts_count_info();
    });

    var TransactionInfoSearch = new SearchManager({
        id: "ts_info",
        search: ts_info_search
    }, {tokens: true});

    var TransactionInfoResults = TransactionInfoSearch.data('results', {count: 2});

    TransactionInfoResults.on('data', function() {
        create_paginator_placeholders();

        var data = this.data();

        var restricted_remaining = data.rows[0][data.fields.indexOf('Total_Remaining')];
        var filtered_remaining = data.rows[1][data.fields.indexOf('Total_Remaining')];

        var min_remaining = data.rows[0][data.fields.indexOf('Min_Remaining')];
        var max_remaining = data.rows[0][data.fields.indexOf('Max_Remaining')];
        var min_start_date = data.rows[0][data.fields.indexOf('Min_Start_Date')];
        var max_start_date = data.rows[0][data.fields.indexOf('Max_Start_Date')];

        ts_restricted_count = parseInt(data.rows[0][data.fields.indexOf('count')], 10);

        display_ts_count_info();

        $("#ts_filtered_remaining").text("Total: " + filtered_remaining);
        $("#ts_restricted_remaining").text("Restricted Total: " + restricted_remaining);
        $("#ts_min_remaining").text("Min: " + min_remaining);
        $("#ts_max_remaining").text("Max: " + max_remaining);
        $("#ts_min_start_date").text("Earliest: " + min_start_date);
        $("#ts_max_start_date").text("Latest: " + max_start_date);
    });

    var TransactionDateRangeSearch = new SearchManager({
        id: "ts_date_range",
        search: ts_date_range_search
    }, {tokens: true});

    var TransactionDateRangeResults = TransactionDateRangeSearch.data('results', {count: 1});

    TransactionDateRangeResults.on('data', function() {
        var min_start_date = this.data().rows[0][0];
        var max_start_date = this.data().rows[0][1];

        var from_start_date = $("#field9 input");
        var to_start_date = $("#field10 input");

        $(from_start_date).datepicker("option", "minDate", min_start_date);
        $(from_start_date).datepicker("option", "maxDate", max_start_date);
        $(to_start_date).datepicker("option", "minDate", min_start_date);
        $(to_start_date).datepicker("option", "maxDate", max_start_date);
    });

    var DataBarCellRenderer = BaseCellRenderer.extend({
        canRender: function(cell) {
            return (cell.field === 'Remaining Bar');
        },
        render: function($td, cell) {
            $td.addClass('data-bar-cell').html(_.template('<div class="data-bar-wrapper"><div class="data-bar" style="width:<%- percent %>%"></div></div>', {
                percent: Math.min(Math.max(parseFloat(cell.value), 0), 100)
            }));
        }
    });

    TransactionSearchView.getVisualization(function(tableView) {
        tableView.table.addCellRenderer(new DataBarCellRenderer());
        tableView.table.render();
    });

    var default_token_values = {
        ts_name_wildcard: '*',
        ts_name_query: 'Name=*',
        ts_sales_rep_query: '"Sales Rep"=*',
        ts_sales_theater_query: '"Sales Theater"=*',
        ts_sub_theater_query: '"Sub-Theater"=*',
        ts_sales_district_query: '"Sales District"=*',
        ts_sub_district_query: '"Sub-District"=*',
        ts_from_start_date: '1000-01-01',
        ts_to_start_date: '9999-99-99',
        ts_min_remaining: '0',
        ts_max_remaining: '999999999'
    };

    for(var token in default_token_values) {
        var default_value = default_token_values[token];

        if(!UnsubmittedTokens.has(token)) {
            UnsubmittedTokens.set(token, default_value);
        }
    }

    if(!UnsubmittedTokens.has('month')) {
        MonthToMonthDetailView.$el.parents('.dashboard-cell').hide();
    }

    ts_submitted_token_on_change('ts_name', 'ts_name_query', 'Name');
    ts_submitted_token_on_change('ts_sales_rep', 'ts_sales_rep_query', 'Sales Rep');
    ts_submitted_token_on_change('ts_sales_theater', 'ts_sales_theater_query', 'Sales Theater');
    ts_submitted_token_on_change('ts_sub_theater', 'ts_sub_theater_query', 'Sub-Theater');
    ts_submitted_token_on_change('ts_sales_district', 'ts_sales_district_query', 'Sales District');
    ts_submitted_token_on_change('ts_sub_district', 'ts_sub_district_query', 'Sub-District');

    SubmittedTokens.on('change:ts_name_wildcard', function(submitted, value) {
        if(!value) {
           UnsubmittedTokens.set("ts_name_wildcard", "*");
           submit_and_update_url();
        }
        else {
            value = $.trim(value);

            if(value.charAt(0) != "*" || value.slice(-1) != "*") {
            UnsubmittedTokens.set("ts_name_wildcard", "*" + value + "*");
            submit_and_update_url();
            }
        }
    });

    SubmittedTokens.on('change:ts_min_remaining', function(submitted, value) {
        if(!value) {
           UnsubmittedTokens.set("ts_min_remaining", default_token_values.ts_min_remaining);
           submit_and_update_url();
        }
    });

    SubmittedTokens.on('change:ts_max_remaining', function(submitted, value) {
        if(!value) {
           UnsubmittedTokens.set("ts_max_remaining", default_token_values.ts_max_remaining);
           submit_and_update_url();
        }
    });

    SubmittedTokens.on('change:month', function() {
        if(!SubmittedTokens.get('month')) {
            MonthToMonthDetailView.$el.parents('.dashboard-cell').hide("slow");
        }
        else {
            MonthToMonthDetailView.$el.parents('.dashboard-cell').show("slow");
        }
    });

    TransactionSearchView.on('click', function(e) {
        e.preventDefault();
        var clicked_field = e.data['click.name2'];

        if(
            clicked_field === 'SFDC Opportunity' ||
            clicked_field === 'SFDC Sales Order' ||
            clicked_field === 'SFDC Ship To Customer'
        ) {
            var id = e.data['click.value2'];

            if(id !== 'N/A') {
                window.open(sfdc_link + id);
            }
        }
    });

    SunburstChart.on('click', function(d) {
        var sunburst_mv_fields = ["mv_sales_theater", "mv_sub_theater", "mv_sales_district", "mv_sub_district"];
        var geo_hierarchy = [d];
        var depth = d.depth;
        var mv_values = [];

        for(var i=0; i<depth-1; i++) {
            d = d.parent;

            geo_hierarchy.unshift(d);
        }

        var mv_fields = ["mv_sales_rep", "mv_name"];

        $.each(mv_fields, function(i, v) {
            var mv = mvc.Components.get(v);

            if(mv.val().length > 0) {
                mv.val([]);
            }
        });

        $.each(sunburst_mv_fields, function(i, v) {
            if(i < geo_hierarchy.length) {
                var mv_value = geo_hierarchy[i].name;

                if(mv_value === "") {
                    mv_value = "*";
                }

                mv_values.push(sunburst_fields[i]+"=\""+mv_value+"\"");

                mvc.Components.get(v).val([mv_values.join(" ")]);
            }
            else {
                mvc.Components.get(v).val([]);
            }
        });
    });

    MonthToMonthView.on('click', function(e) {
        e.preventDefault();

        UnsubmittedTokens.set('form.month', e.data['click.value']);
        submit_and_update_url();
    });
});
