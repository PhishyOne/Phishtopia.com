
import express from "express";
const router = express.Router();
const cache = new Map();

// Render the main project page
router.get("/", async (req, res) => {
    try {
        res.render("project34", {
            bodyClass: "project34",
            extraStyles: ["/project34/styles/main.css"],
            extraScripts: ["/js/canvas.js", "/js/tmdb-autocomplete.js"],
        });
    } catch (err) {
        console.error("DB error:", err);
        res.status(500).send("Database error");
    }
});

// TMDB Autocomplete API
router.get("/api/search", async (req, res) => {
    try {
        const query = req.query.q?.trim();
        if (!query || query.length < 2) return res.json([]);

        if (cache.has(query)) return res.json(cache.get(query));

        // Fetch TMDB data
        const tmdbUrl = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(
            query
        )}&language=en-US&page=1&include_adult=false&api_key=${process.env.TMDB_API_KEY}`;

        const response = await fetch(tmdbUrl);
        const data = await response.json();

        // Map and sort results
        const results = (data.results || [])
            .filter(item => item.media_type === "movie" || item.media_type === "tv")
            .map(item => ({
                id: item.id,
                type: item.media_type,
                title: item.media_type === "movie" ? item.title : item.name,
                year: item.media_type === "movie"
                    ? item.release_date?.slice(0, 4)
                    : item.first_air_date?.slice(0, 4),
                poster: item.poster_path
                    ? `https://image.tmdb.org/t/p/w92${item.poster_path}`
                    : null,
                popularity: item.popularity,
            }))
            .sort((a, b) => {
                const queryLower = query.toLowerCase();
                const aExact = a.title.toLowerCase().startsWith(queryLower) ? 1 : 0;
                const bExact = b.title.toLowerCase().startsWith(queryLower) ? 1 : 0;
                if (aExact !== bExact) return bExact - aExact; // exact matches first
                return b.popularity - a.popularity; // then popularity
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

export default router;
