import { pageLocals } from "../config/pageAssets.js";
import { getAccountDetails } from "../services/account.service.js";

const LOCAL_DB_MESSAGE = "Your dashboard is unavailable in the local preview because no database is configured.";

function isLocalDatabaseUnavailable(error) {
    return process.env.NODE_ENV !== "production" && error?.code === "DB_CONFIG_MISSING";
}

export function createShowDashboard({ getAccount = getAccountDetails } = {}) {
    return async function showDashboardHandler(req, res) {
        try {
            const result = await getAccount(req.session.user.id);
            if (!result.ok) {
                return res.status(result.status || 404).type("text/plain").send(result.error);
            }

            return res.render("dashboard/index", pageLocals("dashboard", {
                disableAnalytics: true,
                robotsContent: "noindex, nofollow",
                account: result.account
            }));
        } catch (error) {
            console.error(error);
            if (isLocalDatabaseUnavailable(error)) {
                return res.status(503).type("text/plain").send(LOCAL_DB_MESSAGE);
            }
            return res.status(500).type("text/plain").send("Server error");
        }
    };
}

export const showDashboard = createShowDashboard();
