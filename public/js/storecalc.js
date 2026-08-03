(function initializeStoreCalcSelection() {
    "use strict";

    const selector = document.querySelector(
        "[data-storecalc-facility-selector]"
    );
    if (!selector) return;

    const emptyState = document.querySelector(
        "[data-storecalc-selection-empty]"
    );
    const liveRegion = document.querySelector(
        "[data-storecalc-selection-live]"
    );
    const panels = Array.from(
        document.querySelectorAll("[data-storecalc-facility-panel]")
    );

    function clearSelection(announcement = "") {
        for (const panel of panels) {
            panel.hidden = true;
        }
        emptyState.hidden = false;
        liveRegion.textContent = announcement;
    }

    function revealSelection(selectionKey) {
        const matches = panels.filter(
            panel => panel.dataset.storecalcFacilityPanel === selectionKey
        );

        if (!selectionKey) {
            clearSelection();
            return;
        }
        if (matches.length !== 1) {
            selector.value = "";
            clearSelection(
                "That facility selection is unavailable. Choose an option from the list."
            );
            return;
        }

        for (const panel of panels) {
            panel.hidden = panel !== matches[0];
        }
        emptyState.hidden = true;
        liveRegion.textContent = matches[0].dataset.selectionAnnouncement;
    }

    selector.addEventListener("change", event => {
        revealSelection(event.target.value);
    });

    clearSelection();
})();
