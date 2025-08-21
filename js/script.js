

$("button.bday-button").click(function () {
    $(this).fadeOut(500, function () {
        $("img.bday-video").removeAttr("hidden");
        $("img.bday-video").fadeIn(500);
    });
});

