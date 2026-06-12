import fetch from "node-fetch";
import { createTimedMemoryCache } from "../cache/timedMemoryCache.js";

const ITEM_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 60 * 1000;
const itemCache = createTimedMemoryCache(ITEM_CACHE_TTL_MS);
const searchCache = createTimedMemoryCache(SEARCH_CACHE_TTL_MS);

function getApiKey() {
    if (!process.env.TMDB_API_KEY) {
        throw new Error("TMDB_API_KEY is missing");
    }
    return process.env.TMDB_API_KEY;
}

function normalizeMediaItem(data, credits, type) {
    const director = credits.crew?.find(crewMember =>
        type === "movie" ? crewMember.job === "Director" : crewMember.job === "Executive Producer"
    )?.name || "N/A";

    return {
        id: data.id,
        type,
        title: type === "movie" ? data.title : data.name,
        year: type === "movie"
            ? data.release_date?.slice(0, 4)
            : data.first_air_date?.slice(0, 4),
        poster: data.poster_path
            ? `https://image.tmdb.org/t/p/w500${data.poster_path}`
            : "/project34/images/placeholder.png",
        genre: data.genres?.map(genre => genre.name).join(", ") || "N/A",
        director,
        cast: credits.cast?.slice(0, 5).map(castMember => castMember.name).join(", ") || "N/A"
    };
}

function normalizeSearchResult(item) {
    return {
        id: item.id,
        type: item.media_type,
        title: item.media_type === "movie" ? item.title : item.name,
        year: item.media_type === "movie"
            ? item.release_date?.slice(0, 4)
            : item.first_air_date?.slice(0, 4),
        poster: item.poster_path
            ? `https://image.tmdb.org/t/p/w92${item.poster_path}`
            : "/project34/images/placeholder.png",
        popularity: item.popularity
    };
}

export async function fetchTMDBItem(type, id) {
    const key = `${type}:${id}`;
    const cached = itemCache.get(key);
    if (cached) return cached;

    const apiKey = getApiKey();
    const baseUrl = `https://api.themoviedb.org/3/${type}/${id}?language=en-US&api_key=${apiKey}`;
    const creditsUrl = `https://api.themoviedb.org/3/${type}/${id}/credits?api_key=${apiKey}`;

    const [infoRes, creditsRes] = await Promise.all([
        fetch(baseUrl),
        fetch(creditsUrl)
    ]);

    if (!infoRes.ok || !creditsRes.ok) {
        throw new Error(`TMDB fetch failed for ${type}:${id}`);
    }

    const data = await infoRes.json();
    const credits = await creditsRes.json();
    const item = normalizeMediaItem(data, credits, type);

    itemCache.set(key, item);
    return item;
}

export async function searchTMDB(query) {
    const normalizedQuery = query?.trim().toLowerCase();
    if (!normalizedQuery || normalizedQuery.length < 2) return [];

    const cached = searchCache.get(normalizedQuery);
    if (cached) return cached;

    const apiKey = getApiKey();
    const tmdbUrl = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(
        normalizedQuery
    )}&language=en-US&page=1&include_adult=false&api_key=${apiKey}`;

    const response = await fetch(tmdbUrl);
    if (!response.ok) throw new Error(`TMDB search failed: ${response.status}`);

    const data = await response.json();
    const results = (data.results || [])
        .filter(item => item.media_type === "movie" || item.media_type === "tv")
        .map(normalizeSearchResult)
        .sort((a, b) => {
            const aExact = a.title.toLowerCase().startsWith(normalizedQuery);
            const bExact = b.title.toLowerCase().startsWith(normalizedQuery);
            if (aExact !== bExact) return bExact - aExact;
            return b.popularity - a.popularity;
        })
        .slice(0, 10);

    searchCache.set(normalizedQuery, results);
    return results;
}
