const OFFICIAL_SOURCE_CHECK_DATE = "2026-08-03";

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
        return value;
    }

    for (const child of Object.values(value)) {
        deepFreeze(child);
    }

    return Object.freeze(value);
}

const PUBLIC_SELECTION_FACILITIES = deepFreeze([
    {
        selectionKey: "us-ga-gdc-hays-state-prison",
        officialName: "Hays State Prison",
        country: {
            codeAlpha2: "US",
            name: "United States"
        },
        jurisdictionName: "Georgia",
        agencyName: "Georgia Department of Corrections",
        locality: "Trion, Georgia",
        facilityType: "State Prison",
        facilityStatus: "listed_by_agency",
        facilityStatusLabel: "Listed by agency",
        source: {
            title: "Hays State Prison — Georgia Department of Corrections",
            url: "https://gdc.georgia.gov/locations/hays-state-prison",
            checkedOn: OFFICIAL_SOURCE_CHECK_DATE
        },
        templateCoverage: {
            status: "unavailable",
            label: "No reviewed StoreCalc template",
            detail: "StoreCalc does not yet have source-backed items, prices, taxes, limits, or audience applicability for this facility."
        }
    }
]);

function validateFixture(facilities) {
    const seenKeys = new Set();

    for (const facility of facilities) {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(facility.selectionKey)) {
            throw new Error("StoreCalc public selection key is invalid.");
        }
        if (seenKeys.has(facility.selectionKey)) {
            throw new Error("StoreCalc public selection keys must be unique.");
        }
        seenKeys.add(facility.selectionKey);

        if (!/^[A-Z]{2}$/.test(facility.country.codeAlpha2)) {
            throw new Error("StoreCalc public country code is invalid.");
        }
        if (!facility.officialName || !facility.agencyName || !facility.locality) {
            throw new Error("StoreCalc public facility context is incomplete.");
        }

        const sourceUrl = new URL(facility.source.url);
        if (sourceUrl.protocol !== "https:") {
            throw new Error("StoreCalc public facility sources must use HTTPS.");
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(facility.source.checkedOn)) {
            throw new Error("StoreCalc public facility source date is invalid.");
        }
        if (facility.templateCoverage.status !== "unavailable") {
            throw new Error("StoreCalc must not expose an unreviewed template.");
        }
    }
}

validateFixture(PUBLIC_SELECTION_FACILITIES);

function cloneFacility(facility) {
    return {
        ...facility,
        country: { ...facility.country },
        source: { ...facility.source },
        templateCoverage: { ...facility.templateCoverage }
    };
}

export function listPublicSelectionFacilities() {
    return PUBLIC_SELECTION_FACILITIES
        .map(cloneFacility)
        .sort((left, right) => {
            return (
                left.country.name.localeCompare(right.country.name) ||
                left.jurisdictionName.localeCompare(right.jurisdictionName) ||
                left.officialName.localeCompare(right.officialName) ||
                left.agencyName.localeCompare(right.agencyName) ||
                left.locality.localeCompare(right.locality)
            );
        });
}

export const PUBLIC_SELECTION_SCHEMA_VERSION = 1;
