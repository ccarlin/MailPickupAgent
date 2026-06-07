function multiFilterSetup(column, width = 200)
{
    // Create select element
    let select = document.createElement('select');
    select.multiple = true;
    select.className = 'SlectBox';
    if (width)
        select.style.maxWidth = width + 'px';
    else
        select.style.width = '100%';              
    column.footer().replaceChildren(select);

    // Add list of options
    column.data().unique().sort().each(function (d, j) {
        var opt = document.createElement('option');
        opt.value = $('<div/>').html(d).text(); 
        opt.innerHTML = $('<div/>').html(d).text();        
        select.add(opt);
    });

       // Initialize SumoSelect
    let sumoOptions = {
        placeholder: '',
        okCancelInMulti: true,
        forceCustomRendering: true,
        up: false,
        okCancelInMulti: true,
        search: true,
        searchText: 'Search...',
        selectAll: true,
        showTitle: true,
        maxWidth: width + 'px'
    };
    if (width && width < 200) {
        sumoOptions.csvDispCount = 1;
    }
    $(select).SumoSelect(sumoOptions);

    // Apply listener for user change in value (SumoSelect triggers 'change')
    $(select).on('change', function () {
        let selected = $(this).val() || [];
        selected = selected.map(v => DataTable.util.escapeRegex(v) + '$').filter(Boolean);
        let val = selected.length ? selected.join('|') : '';
        column
            .search(val ? '(' + val + ')' : '', true, false)
            .draw();
    });
}

function standardFilterSetup(column, maxlength = 0)
{
    // Create select element
    let select = document.createElement('select');
    select.add(new Option('All', ''));                            
    column.footer().replaceChildren(select);

    // Apply listener for user change in value
    select.addEventListener('change', function () {
        var val = DataTable.util.escapeRegex(select.value);
        column
            .search(val ? '^' + val + '$' : '', true, false)
            .draw();
    });

    // Add list of options
    column.data().unique().sort().each(function (d, j) {
        var opt = document.createElement('option');
        opt.value = $('<div/>').html(d).text();
        if (maxlength > 0) {
            opt.innerHTML = $('<div/>').html(d).text().substr(0, maxlength);
        } 
        else {
            opt.innerHTML = $('<div/>').html(d).text();
        }
        select.add(opt);
    });
}