document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".nav-item.dropdown").forEach(dropdown => {

        dropdown.addEventListener("click", function (e) {
            e.stopPropagation();

            // close others
            document.querySelectorAll(".nav-item.dropdown").forEach(d => {
                if (d !== dropdown) d.classList.remove("active");
            });

            dropdown.classList.toggle("active");
        });
    });

    document.addEventListener("click", function () {
        document.querySelectorAll(".nav-item.dropdown")
            .forEach(d => d.classList.remove("active"));
    });
});
  