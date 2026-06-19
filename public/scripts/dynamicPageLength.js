function dynamicPageLength(tableId) {
    var api = $(tableId).DataTable();
    if (!api) return;
    var winH = window.innerHeight;
    var tableTop = $(tableId).offset().top;
    var rows = $(tableId + ' tbody tr');
    var rowH = rows.length > 1 ? rows.eq(1).height() : rows.eq(0).height();
    if (!rowH || rowH < 10) return;
    var availH = winH - tableTop;
    availH -= ($('.dt-info').outerHeight(true) || 28);
    availH -= ($('.dt-paging').outerHeight(true) || 36);
    availH -= ($('.dt-layout-row:first').outerHeight(true) || 48);
    availH -= ($(tableId + ' thead').outerHeight(true) || 28);
    availH -= ($(tableId + ' tfoot').outerHeight(true) || 24);
    availH -= 14;
    var len = Math.max(5, Math.floor(availH / rowH));
    if (len !== api.page.len()) {
        api.page.len(len).draw();
    }
}

var resizeState = {};
$(window).on('resize', function () {
    $('table.dataTable').each(function () {
        var id = '#' + this.id;
        if (!resizeState[id]) resizeState[id] = {};
        clearTimeout(resizeState[id].timer);
        resizeState[id].timer = setTimeout(function () { dynamicPageLength(id); }, 100);
    });
});
