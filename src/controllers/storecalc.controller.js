export function showStoreCalcPage(req, res) {
    return res.render("storecalc/index", {
        title: "StoreCalc Online",
        bodyClass: "storecalc",
        extraStyles: [],
        extraScripts: []
    });
}