const PLACEHOLDER_POSTER = "/images/youlist-placeholder.jpg";
const MAX_COMMENT_LENGTH = 1000;
const MIN_SEARCH_CHARS = 2;

const root = document.querySelector(".youlist-container");
if (!root) throw new Error("YouList container not found");

const currentUserId = Number(root.dataset.currentUserId || 0);
const csrfToken = root.dataset.csrfToken || "";
const input = document.querySelector(".search-input");
if (!input) throw new Error("Search input not found");

const wrapper = input.closest(".search-wrapper");
if (!wrapper) throw new Error("Search wrapper not found");

const dropdown = document.createElement("ul");
dropdown.className = "autocomplete-dropdown";
wrapper.appendChild(dropdown);

const commentsByCard = new WeakMap();
const commentTextById = new Map();
const pageCache = new Map();
let searchTimer;
let lastQuery = "";
let currentPage = 1;
let totalPages = 1;

function text(value, fallback = "N/A") {
    if (value === null || value === undefined || value === "") return fallback;
    return String(value);
}

function createElement(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
}

function setContainerMessage(container, message) {
    container.replaceChildren(createElement("p", "", message));
}

function safePosterUrl(value) {
    if (typeof value !== "string") return PLACEHOLDER_POSTER;

    try {
        const url = new URL(value, window.location.origin);
        const isLocal = url.origin === window.location.origin && url.pathname.startsWith("/");
        const isTmdb = url.protocol === "https:" && url.hostname === "image.tmdb.org";
        return isLocal || isTmdb ? url.href : PLACEHOLDER_POSTER;
    } catch {
        return PLACEHOLDER_POSTER;
    }
}

function setPoster(image, source, title) {
    image.src = safePosterUrl(source);
    image.alt = `${text(title, "Media")} poster`;
    image.referrerPolicy = "no-referrer";
}

function appendHighlightedTitle(container, title, query) {
    const value = text(title, "Untitled");
    const index = value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
    if (index < 0) {
        container.textContent = value;
        return;
    }

    container.append(
        document.createTextNode(value.slice(0, index)),
        createElement("b", "", value.slice(index, index + query.length)),
        document.createTextNode(value.slice(index + query.length))
    );
}

async function readJson(response) {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) throw new Error("Invalid server response");
    return response.json();
}

function csrfHeaders() {
    return {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken
    };
}

function buildCloseDropdownItem() {
    const close = createElement("li", "close-dropdown", "✕");
    close.setAttribute("role", "button");
    close.setAttribute("aria-label", "Close search results");
    return close;
}

function buildPlaceholderItem(message = "Start typing to search...") {
    const item = createElement("li", "autocomplete-item placeholder");
    const image = createElement("img", "autocomplete-poster");
    setPoster(image, PLACEHOLDER_POSTER, "Placeholder");
    item.append(image, createElement("span", "autocomplete-title", message));
    return item;
}

function buildAutocompleteItem(item, query) {
    const row = createElement("li", "autocomplete-item");
    const id = Number(item?.id);
    const type = item?.type;
    if (!Number.isSafeInteger(id) || id < 1 || !["movie", "tv"].includes(type)) {
        return null;
    }

    row.dataset.id = String(id);
    row.dataset.type = type;

    const image = createElement("img", "autocomplete-poster");
    setPoster(image, item.poster, item.title);

    const title = createElement("span", "autocomplete-title");
    appendHighlightedTitle(title, item.title, query);
    title.append(document.createTextNode(` (${text(item.year)})`));

    const mediaType = createElement(
        "span",
        "autocomplete-type",
        type === "movie" ? "🎬" : "📺"
    );

    row.append(image, title, mediaType);
    return row;
}

async function renderResults(query) {
    dropdown.replaceChildren(buildCloseDropdownItem());

    if (!query || query.length < MIN_SEARCH_CHARS) {
        dropdown.style.display = "none";
        return;
    }

    try {
        const response = await fetch(`/youlist/api/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error("Search failed");
        const results = await readJson(response);

        if (!Array.isArray(results) || results.length === 0) {
            dropdown.appendChild(buildPlaceholderItem("No matching movies or shows."));
        } else {
            for (const item of results) {
                const row = buildAutocompleteItem(item, query);
                if (row) dropdown.appendChild(row);
            }
        }

        dropdown.style.display = "block";
    } catch (error) {
        console.error("Autocomplete error:", error);
        dropdown.appendChild(buildPlaceholderItem("Search is temporarily unavailable."));
        dropdown.style.display = "block";
    }
}

input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const query = input.value.trim();

    if (query === lastQuery) return;
    lastQuery = query;

    if (query.length < MIN_SEARCH_CHARS) {
        dropdown.style.display = "none";
        return;
    }

    searchTimer = setTimeout(() => renderResults(query), 300);
});

document.querySelector(".clear-input")?.addEventListener("click", () => {
    input.value = "";
    lastQuery = "";
    dropdown.style.display = "none";
    dropdown.replaceChildren();
    input.focus();
});

dropdown.addEventListener("click", event => {
    if (event.target.classList.contains("close-dropdown")) {
        dropdown.style.display = "none";
    }
});

document.addEventListener("click", event => {
    if (!wrapper.contains(event.target)) dropdown.style.display = "none";
});

dropdown.addEventListener("click", async event => {
    const item = event.target.closest(".autocomplete-item");
    if (!item || item.classList.contains("placeholder")) return;

    dropdown.style.display = "none";
    const id = item.dataset.id;
    const type = item.dataset.type;

    try {
        const response = await fetch(`/youlist/api/item/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
        if (!response.ok) throw new Error("Item fetch failed");
        const data = await readJson(response);

        const tempCard = document.getElementById("temp-card");
        if (!tempCard) return;

        tempCard.querySelector("#temp-title").textContent = text(data.title, "Untitled");
        setPoster(tempCard.querySelector("#temp-poster"), data.poster, data.title);
        tempCard.querySelector("#temp-director").textContent = `Director: ${text(data.director)}`;
        tempCard.querySelector("#temp-year").textContent = `Year: ${text(data.year)}`;
        tempCard.querySelector("#temp-genre").textContent = `Genre: ${text(data.genre)}`;
        tempCard.querySelector("#temp-cast").textContent = `Stars: ${text(data.cast)}`;
        tempCard.dataset.movieId = id;
        tempCard.dataset.type = type;
        delete tempCard.dataset.editingCommentId;

        const commentBox = tempCard.querySelector("#temp-comment");
        commentBox.value = "";
        tempCard.style.display = "flex";
        commentBox.focus();
        tempCard.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
        console.error("Item fetch error:", error);
        alert("Failed to load that item");
    }
});

function closeTempCard() {
    const tempCard = document.getElementById("temp-card");
    if (!tempCard) return;
    tempCard.style.display = "none";
    delete tempCard.dataset.editingCommentId;
    const commentBox = tempCard.querySelector("#temp-comment");
    if (commentBox) commentBox.value = "";
}

document.getElementById("cancel-comment")?.addEventListener("click", closeTempCard);

document.addEventListener("click", event => {
    if (!event.target.classList.contains("edit-comment")) return;

    const commentId = event.target.dataset.id;
    const commentText = commentTextById.get(commentId);
    const movieCard = event.target.closest(".movie-card");
    const tempCard = document.getElementById("temp-card");
    if (!movieCard || !tempCard || commentText === undefined) return;

    tempCard.dataset.movieId = movieCard.dataset.movieId;
    tempCard.dataset.type = movieCard.dataset.type;
    tempCard.dataset.editingCommentId = commentId;
    tempCard.querySelector("#temp-title").textContent =
        movieCard.querySelector(".Title h2").textContent;
    setPoster(
        tempCard.querySelector("#temp-poster"),
        movieCard.querySelector(".movie-poster img").src,
        movieCard.querySelector(".Title h2").textContent
    );
    tempCard.querySelector("#temp-director").textContent =
        movieCard.querySelector(".Director h3").textContent;
    tempCard.querySelector("#temp-genre").textContent =
        movieCard.querySelector(".Genre h3").textContent;
    tempCard.querySelector("#temp-cast").textContent =
        movieCard.querySelector(".Cast h3").textContent;
    tempCard.querySelector("#temp-year").textContent =
        movieCard.querySelector(".ReleaseYear h3").textContent;

    const commentBox = tempCard.querySelector("#temp-comment");
    commentBox.value = commentText;
    tempCard.style.display = "flex";
    commentBox.focus();
    tempCard.scrollIntoView({ behavior: "smooth", block: "center" });
});

document.addEventListener("click", async event => {
    if (!event.target.classList.contains("delete-comment")) return;
    const commentId = event.target.dataset.id;
    if (!confirm("Delete this comment?")) return;

    try {
        const response = await fetch(`/youlist/api/comment/${encodeURIComponent(commentId)}`, {
            method: "DELETE",
            headers: { "X-CSRF-Token": csrfToken }
        });
        const result = await readJson(response);
        if (!response.ok || result.success !== true) {
            throw new Error(result.error || "Delete failed");
        }
        window.location.reload();
    } catch (error) {
        console.error(error);
        alert("Failed to delete comment");
    }
});

function appendField(parent, className, label, value) {
    const wrapperElement = createElement("div", className);
    wrapperElement.appendChild(createElement("h3", "", `${label}: ${text(value)}`));
    parent.appendChild(wrapperElement);
}

function buildCommentLine(comment, includeControls) {
    const line = createElement("p");
    const username = createElement("span", "username", `${text(comment.username, "Anonymous")}:`);
    line.append(username, document.createTextNode(` ${text(comment.comment, "")}`));

    if (includeControls) {
        const id = String(comment.id);
        commentTextById.set(id, text(comment.comment, ""));

        const edit = createElement("button", "edit-comment", "Edit");
        edit.type = "button";
        edit.dataset.id = id;

        const remove = createElement("button", "delete-comment", "Delete");
        remove.type = "button";
        remove.dataset.id = id;

        line.append(document.createTextNode(" "), edit, document.createTextNode(" "), remove);
    }

    return line;
}

function buildMovieCard(movie) {
    const card = createElement("section", "movielist-section movie-card");
    card.dataset.movieId = String(movie.id);
    card.dataset.type = ["movie", "tv"].includes(movie.type) ? movie.type : "movie";

    const comments = Array.isArray(movie.comments) ? movie.comments : [];
    commentsByCard.set(card, comments);

    const posterWrapper = createElement("div", "movie-poster");
    const poster = createElement("img");
    setPoster(poster, movie.poster, movie.title);
    posterWrapper.appendChild(poster);

    const details = createElement("div", "Details");
    const titleWrapper = createElement("div", "Title");
    titleWrapper.appendChild(
        createElement("h2", "", `${text(movie.title, "Untitled")} (${text(movie.year)})`)
    );
    details.appendChild(titleWrapper);
    appendField(details, "Director", "Director", movie.director);
    appendField(details, "ReleaseYear", "Year", movie.year);
    appendField(details, "Genre", "Genre", movie.genre);
    appendField(details, "Cast", "Stars", movie.cast);

    const commentsSection = createElement("div", "CommentsSection");
    const latest = comments[0];
    const latestLine = latest
        ? buildCommentLine(latest, false)
        : createElement("p", "comment", "No comments yet");
    latestLine.classList.add("comment");

    const expand = createElement("button", "expand-comments", "Show all");
    expand.type = "button";
    expand.hidden = comments.length === 0;

    const allComments = createElement("div", "all-comments");
    allComments.style.display = "none";
    commentsSection.append(latestLine, expand, allComments);

    expand.addEventListener("click", () => {
        const expanded = allComments.style.display !== "none";
        if (expanded) {
            latestLine.style.display = "block";
            allComments.style.display = "none";
            expand.textContent = "Show all";
            return;
        }

        allComments.replaceChildren();
        for (const comment of commentsByCard.get(card) || []) {
            const isOwner = currentUserId > 0 && Number(comment.user_id) === currentUserId;
            allComments.appendChild(buildCommentLine(comment, isOwner));
        }
        latestLine.style.display = "none";
        allComments.style.display = "block";
        expand.textContent = "Hide all";
    });

    details.appendChild(commentsSection);
    card.append(posterWrapper, details);
    return card;
}

function renderPage(data) {
    const container = document.getElementById("movie-list");
    commentTextById.clear();
    container.replaceChildren();

    if (!data || !Array.isArray(data.results) || data.results.length === 0) {
        setContainerMessage(container, "No movies to show.");
        totalPages = 1;
        currentPage = 1;
    } else {
        for (const movie of data.results) container.appendChild(buildMovieCard(movie));
        currentPage = Number(data.page) || 1;
        totalPages = Math.max(Number(data.totalPages) || 1, 1);
    }

    document.getElementById("prev-page").disabled = currentPage <= 1;
    document.getElementById("next-page").disabled = currentPage >= totalPages;
}

async function loadPage(page = 1) {
    const safePage = Math.max(Number.parseInt(page, 10) || 1, 1);
    const container = document.getElementById("movie-list");

    if (pageCache.has(safePage)) {
        renderPage(pageCache.get(safePage));
        return;
    }

    setContainerMessage(container, "Loading movies...");

    try {
        const response = await fetch(`/youlist/api/list?page=${safePage}`);
        if (!response.ok) throw new Error("Failed to fetch list");
        const data = await readJson(response);
        pageCache.set(safePage, data);
        renderPage(data);

        if (safePage < data.totalPages && !pageCache.has(safePage + 1)) {
            fetch(`/youlist/api/list?page=${safePage + 1}`)
                .then(nextResponse => {
                    if (!nextResponse.ok) throw new Error("Preload failed");
                    return readJson(nextResponse);
                })
                .then(nextData => pageCache.set(safePage + 1, nextData))
                .catch(() => {});
        }
    } catch (error) {
        console.error("Load page error:", error);
        setContainerMessage(container, "Failed to load movies — try refreshing.");
    }
}

document.getElementById("prev-page")?.addEventListener("click", () => {
    if (currentPage > 1) loadPage(currentPage - 1);
});

document.getElementById("next-page")?.addEventListener("click", () => {
    if (currentPage < totalPages) loadPage(currentPage + 1);
});

document.getElementById("submit-comment")?.addEventListener("click", async () => {
    const tempCard = document.getElementById("temp-card");
    const commentBox = tempCard.querySelector("#temp-comment");
    const comment = commentBox.value.trim();

    if (!comment) return alert("Please enter a comment");
    if (comment.length > MAX_COMMENT_LENGTH) {
        return alert(`Comments are limited to ${MAX_COMMENT_LENGTH} characters`);
    }

    const movieId = tempCard.dataset.movieId;
    const type = tempCard.dataset.type;
    const editingId = tempCard.dataset.editingCommentId;

    try {
        const response = editingId
            ? await fetch(`/youlist/api/comment/${encodeURIComponent(editingId)}`, {
                method: "PUT",
                headers: csrfHeaders(),
                body: JSON.stringify({ comment })
            })
            : await fetch("/youlist/api/comment", {
                method: "POST",
                headers: csrfHeaders(),
                body: JSON.stringify({ movie_id: movieId, type, comment })
            });

        const result = await readJson(response);
        if (!response.ok || result.success !== true) {
            throw new Error(result.error || "Comment request failed");
        }

        closeTempCard();
        window.location.reload();
    } catch (error) {
        console.error("Comment submit error:", error);
        alert("Failed to submit comment");
    }
});

loadPage(1);
