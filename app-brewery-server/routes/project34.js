import express from "express";
import fetch from "node-fetch";
import db from "../db.js";
const router = express.Router();
const cache = new Map();           // for autocomplete queries
const tmdbCache = new Map();       // for TMDB items
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
let movieList = []; // in-memory placeholder

/* =========================
   Cached TMDB Fetch Helper
========================= */
async function fetchTMDBItem(type, id) {
    const key = `${type}:${id}`;

    // Return cached item if exists
    if (tmdbCache.has(key)) return tmdbCache.get(key);

    const baseUrl = `https://api.themoviedb.org/3/${type}/${id}?language=en-US&api_key=${process.env.TMDB_API_KEY}`;
    const creditsUrl = `https://api.themoviedb.org/3/${type}/${id}/credits?api_key=${process.env.TMDB_API_KEY}`;

    const [infoRes, creditsRes] = await Promise.all([
        fetch(baseUrl),
        fetch(creditsUrl)
    ]);

    if (!infoRes.ok || !creditsRes.ok) {
        throw new Error(`TMDB fetch failed for ${type}:${id}`);
    }

    const data = await infoRes.json();
    const credits = await creditsRes.json();

    const director =
        credits.crew?.find(c =>
            type === "movie" ? c.job === "Director" : c.job === "Executive Producer"
        )?.name || "N/A";

    const item = {
        id: data.id,
        type,
        title: type === "movie" ? data.title : data.name,
        year:
            type === "movie"
                ? data.release_date?.slice(0, 4)
                : data.first_air_date?.slice(0, 4),
        poster: data.poster_path
            ? `https://image.tmdb.org/t/p/w500${data.poster_path}`
            : "/project34/images/placeholder.png",
        genre: data.genres?.map(g => g.name).join(", ") || "N/A",
        director,
        cast: credits.cast?.slice(0, 5).map(c => c.name).join(", ") || "N/A"
    };

    // Cache it
    tmdbCache.set(key, item);
    setTimeout(() => tmdbCache.delete(key), CACHE_TTL);

    return item;
}

/* =========================
   Main Page
========================= */
router.get("/", async (req, res) => {
    try {
        res.render("project34", {
            bodyClass: "project34",
            extraStyles: ["/project34/styles/main.css"],
            extraScripts: ["/js/canvas.js", "/js/youlist.js"],
            movieList: JSON.stringify(movieList)
        });
    } catch (err) {
        console.error("Render error:", err);
        res.status(500).send("Server error");
    }
});

/* =========================
   TMDB Autocomplete
========================= */
router.get("/api/search", async (req, res) => {
    try {
        const query = req.query.q?.trim().toLowerCase();
        if (!query || query.length < 2) return res.json([]);

        if (cache.has(query)) return res.json(cache.get(query));

        const tmdbUrl = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(
            query
        )}&language=en-US&page=1&include_adult=false&api_key=${process.env.TMDB_API_KEY}`;

        const response = await fetch(tmdbUrl);
        if (!response.ok) throw new Error(`TMDB search failed: ${response.status}`);

        const data = await response.json();

        const results = (data.results || [])
            .filter(item => item.media_type === "movie" || item.media_type === "tv")
            .map(item => ({
                id: item.id,
                type: item.media_type,
                title: item.media_type === "movie" ? item.title : item.name,
                year:
                    item.media_type === "movie"
                        ? item.release_date?.slice(0, 4)
                        : item.first_air_date?.slice(0, 4),
                poster: item.poster_path
                    ? `https://image.tmdb.org/t/p/w92${item.poster_path}`
                    : "/project34/images/placeholder.png",
                popularity: item.popularity
            }))
            .sort((a, b) => {
                const q = query;
                const aExact = a.title.toLowerCase().startsWith(q);
                const bExact = b.title.toLowerCase().startsWith(q);
                if (aExact !== bExact) return bExact - aExact;
                return b.popularity - a.popularity;
            })
            .slice(0, 10);

        cache.set(query, results);
        setTimeout(() => cache.delete(query), 60_000);

        res.json(results);
    } catch (err) {
        console.error("TMDB search error:", err);
        res.status(500).json({ error: "TMDB search failed" });
    }
});

/* =========================
   Movie / TV Details (Cached)
========================= */
router.get("/api/item/:type/:id", async (req, res) => {
    try {
        const { type, id } = req.params;

        if (!["movie", "tv"].includes(type)) {
            return res.status(400).json({ error: "Invalid media type" });
        }

        const item = await fetchTMDBItem(type, id);
        res.json(item);
    } catch (err) {
        console.error("TMDB detail error:", err);
        res.status(500).json({ error: "Failed to fetch item details" });
    }
});

/* =========================
   Fetch Full List (Paginated + Cached)
========================= */
const PAGE_SIZE = 20;

router.get("/api/list", async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const offset = (page - 1) * PAGE_SIZE;

        // 1️⃣ Count DISTINCT movies
        const countResult = await db.query(`SELECT COUNT(*) AS total FROM fullstack.youlist_movies`);
        const totalItems = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(totalItems / PAGE_SIZE);

        // 2️⃣ Get movie IDs for this page
        const movieRows = await db.query(
            `
            SELECT movie_id, type
            FROM (
                SELECT movie_id, type, MAX(id) AS last_id
                FROM fullstack.youlist_movies
                GROUP BY movie_id, type) 
            AS t
            ORDER BY last_id DESC
            LIMIT $1 OFFSET $2;
            `,
            [PAGE_SIZE, offset]
        );

        // 3️⃣ For each movie, fetch comments + TMDB once
        const results = await Promise.all(
            movieRows.rows.map(async ({ movie_id, type }) => {
                // fetch comments
                const commentResult = await db.query(
                    `
                    SELECT id, comment
                    FROM fullstack.youlist_movies
                    WHERE movie_id = $1 AND type = $2
                    ORDER BY id DESC
                    `,
                    [movie_id, type]
                );

                // fetch TMDB (cached)
                const tmdb = await fetchTMDBItem(type, movie_id);

                return {
                    ...tmdb,
                    comments: commentResult.rows
                };
            })
        );

        res.json({
            page,
            pageSize: PAGE_SIZE,
            totalItems,
            totalPages,
            results
        });
    } catch (err) {
        console.error("Grouped list fetch error:", err);
        res.status(500).json({ error: "Failed to load list" });
    }
});

/* =========================
   Add Comment (Movie/TV)
========================= */
router.post("/api/comment", async (req, res) => {
    try {
        const { movie_id, type, comment } = req.body;

        if (!movie_id || !type || !comment) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        if (!["movie", "tv"].includes(type)) {
            return res.status(400).json({ error: "Invalid media type" });
        }

        // TEMP user id (until auth exists)
        const userId = 1;

        await db.query(
            `
            INSERT INTO fullstack.youlist_movies (movie_id, type, comment, user_id)
            VALUES ($1, $2, $3, $4)
            `,
            [movie_id, type, comment, userId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error("Add comment error:", err);
        res.status(500).json({ error: "Failed to add comment" });
    }
});
/* ========================= */
async function prewarmCache() {
    try {
        const { rows } = await db.query(
            `
            SELECT movie_id, type, comment
            FROM fullstack.youlist_movies
            ORDER BY id DESC
            LIMIT 20
            `
        );

        await Promise.all(
            rows.map(row =>
                fetchTMDBItem(row.type, row.movie_id)
                    .catch(() => null) // ignore failures
            )
        );

        console.log("TMDB cache pre-warmed for first page!");
    } catch (err) {
        console.error("Cache pre-warm error:", err);
    }
}
// Call prewarm on server start
prewarmCache();

export default router;
