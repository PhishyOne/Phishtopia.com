// =========================
// Setup
// =========================
const input = document.querySelector(".search-input");
if (!input) throw new Error("Search input not found");

const wrapper = input.closest(".search-wrapper");
if (!wrapper) throw new Error("Search wrapper not found");

const dropdown = document.createElement("ul");
dropdown.className = "autocomplete-dropdown";
wrapper.appendChild(dropdown);

let timer;
let lastQuery = "";
const MIN_CHARS = 2;

// =========================
// Helpers (Security + Regex)
// =========================
function escapeHTML(str) {
    return str.replace(/[&<>"']/g, s => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[s]));
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// =========================
// Placeholder Item
// =========================
const placeholderItem = `
  <li class="autocomplete-item placeholder">
    <img src="/project34/images/placeholder.png" class="autocomplete-poster">
    <span class="autocomplete-title">Start typing to search...</span>
  </li>
`;

// =========================
// Render Autocomplete
// =========================
async function renderResults(query) {
    dropdown.innerHTML = `<li class="close-dropdown">✕</li>`;

    if (!query || query.length < MIN_CHARS) {
        dropdown.style.display = "none";
        return;
    }

    try {
        const res = await fetch(`/youlist/api/search?q=${encodeURIComponent(query)}`);
        const results = await res.json();

        if (!results.length) {
            dropdown.innerHTML += placeholderItem;
        } else {
            const safeQuery = escapeRegex(query);
            const regex = new RegExp(`(${safeQuery})`, "i");

            dropdown.innerHTML += results.map(item => {
                const safeTitle = escapeHTML(item.title);
                const title = safeTitle.replace(regex, "<b>$1</b>");

                return `
                    <li class="autocomplete-item"
                        data-id="${item.id}"
                        data-type="${item.type}">
                        <img src="${item.poster}" class="autocomplete-poster">
                        <span class="autocomplete-title">
                            ${title} (${item.year || "N/A"})
                        </span>
                        <span class="autocomplete-type">
                            ${item.type === "movie" ? "🎬" : "📺"}
                        </span>
                    </li>
                `;
            }).join("");
        }

        dropdown.style.display = "block";
    } catch (err) {
        console.error("Autocomplete error:", err);
        dropdown.innerHTML += placeholderItem;
        dropdown.style.display = "block";
    }
}

// =========================
// Input (Debounced)
// =========================
input.addEventListener("input", () => {
    clearTimeout(timer);
    const query = input.value.trim();

    if (query === lastQuery) return;
    lastQuery = query;

    if (query.length < MIN_CHARS) {
        dropdown.style.display = "none";
        return;
    }

    timer = setTimeout(() => renderResults(query), 300);
});

// =========================
// Clear Input
// =========================
document.querySelector(".clear-input")?.addEventListener("click", () => {
    input.value = "";
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
    input.focus();
});

// =========================
// Close Dropdown (button)
// =========================
dropdown.addEventListener("click", e => {
    if (e.target.classList.contains("close-dropdown")) {
        dropdown.style.display = "none";
    }
});

// =========================
// Close Dropdown (outside click)
// =========================
document.addEventListener("click", (e) => {
    if (!wrapper.contains(e.target)) {
        dropdown.style.display = "none";
    }
});

// =========================
// Select Item
// =========================
dropdown.addEventListener("click", async e => {
    const item = e.target.closest(".autocomplete-item");
    if (!item || item.classList.contains("placeholder")) return;

    dropdown.style.display = "none";

    const id = item.dataset.id;
    const type = item.dataset.type;

    try {
        const res = await fetch(`/youlist/api/item/${type}/${id}`);
        const data = await res.json();

        const tempCard = document.getElementById("temp-card");
        if (!tempCard) return;

        tempCard.querySelector("#temp-title").textContent = data.title;
        tempCard.querySelector("#temp-poster").src = data.poster;
        tempCard.querySelector("#temp-director").textContent = `Director: ${data.director}`;
        tempCard.querySelector("#temp-year").textContent = `Year: ${data.year || "N/A"}`;
        tempCard.querySelector("#temp-genre").textContent = `Genre: ${data.genre}`;
        tempCard.querySelector("#temp-cast").textContent = `Stars: ${data.cast}`;

        tempCard.dataset.movieId = id;
        tempCard.dataset.type = type;

        const commentBox = tempCard.querySelector("#temp-comment");
        commentBox.value = "";

        tempCard.style.display = "flex";

        // UX improvements
        commentBox.focus();
        tempCard.scrollIntoView({ behavior: "smooth", block: "center" });

    } catch (err) {
        console.error("Item fetch error:", err);
    }
});

// =========================
// Cancel Comment
// =========================
document.getElementById("cancel-comment")?.addEventListener("click", () => {
    document.getElementById("temp-card").style.display = "none";
});

// =========================
// Edit Comment 
// =========================
document.addEventListener("click", (e) => {
    if (!e.target.classList.contains("edit-comment")) return;

    const commentId = e.target.dataset.id;
    const commentText = decodeURIComponent(e.target.dataset.comment);

    // Find parent movie card
    const movieCard = e.target.closest(".movie-card");
    if (!movieCard) return;

    const movieId = movieCard.dataset.movieId;
    const type = movieCard.dataset.type;

    //  Get temp card
    const tempCard = document.getElementById("temp-card");

    // Copy movie data into temp card
    tempCard.dataset.movieId = movieId;
    tempCard.dataset.type = type;
    tempCard.dataset.editingCommentId = commentId;

    // Copy movie info (so it's not blank)
    tempCard.querySelector("#temp-title").textContent =
        movieCard.querySelector(".Title h2").textContent;

    tempCard.querySelector("#temp-poster").src =
        movieCard.querySelector(".movie-poster img").src;

    tempCard.querySelector("#temp-director").textContent =
        movieCard.querySelector(".Director h3").textContent;

    tempCard.querySelector("#temp-genre").textContent =
        movieCard.querySelector(".Genre h3").textContent;

    tempCard.querySelector("#temp-cast").textContent =
        movieCard.querySelector(".Cast h3").textContent;

    tempCard.querySelector("#temp-year").textContent =
        movieCard.querySelector(".Title h2").textContent;

    // Set comment text
    const commentBox = tempCard.querySelector("#temp-comment");
    commentBox.value = commentText;

    tempCard.style.display = "flex";

    commentBox.focus();
    tempCard.scrollIntoView({ behavior: "smooth", block: "center" });
});

// =========================
// Delete Comment
// =========================
document.addEventListener("click", async (e) => {
    if (!e.target.classList.contains("delete-comment")) return;
    const commentId = e.target.dataset.id;
    if (!confirm("Delete this comment?")) return;
    try {
        const res = await fetch(`/youlist/api/comment/${commentId}`, {
            method: "DELETE"
        });
        if (!res.ok) throw new Error("Delete failed");
        window.location.reload();

    } catch (err) {
        console.error(err);
        alert("Failed to delete comment");
    }
});

// =========================
// Pagination State
// =========================
let currentPage = 1;
let totalPages = 1;
const pageCache = {};

// =========================
// Render Page
// =========================
function renderPage(data) {
    const container = document.getElementById("movie-list");
    container.innerHTML = "";

    if (!data.results.length) {
        container.innerHTML = "<p>No movies to show.</p>";
        return;
    }

    totalPages = data.totalPages;

    data.results.forEach(movie => {
        const card = document.createElement("section");
        card.className = "movielist-section movie-card";
        card.dataset.movieId = movie.id;
        card.dataset.type = movie.type;
        card.dataset.comments = JSON.stringify(movie.comments || []);

        const latestComment = movie.comments?.[0]?.comment || "No comments yet";

        card.innerHTML = `
            <div class="movie-poster">
                <img src="${movie.poster}" alt="${movie.title}">
            </div>
            <div class="Details">
                <div class="Title"><h2>${movie.title} (${movie.year || "N/A"})</h2></div>
                <div class="Director"><h3>Director: ${movie.director}</h3></div>
                <div class="Genre"><h3>Genre: ${movie.genre}</h3></div>
                <div class="Cast"><h3>Stars: ${movie.cast}</h3></div>

                <div class="CommentsSection">
                    <p class="comment">
                        <span class="username">${movie.comments?.[0]?.username || "Anonymous"}</span>: ${latestComment}
                    </p>
                    <button class="expand-comments">Show all</button>
                    <div class="all-comments" style="display:none;"></div>
                </div>
            </div>
        `;

        container.appendChild(card);

        const expandBtn = card.querySelector(".expand-comments");
        const allCommentsDiv = card.querySelector(".all-comments");

        expandBtn?.addEventListener("click", () => {
            const allComments = JSON.parse(card.dataset.comments || "[]");

            if (allCommentsDiv.style.display === "none") {
                card.querySelector("p.comment").style.display = "none";

                allCommentsDiv.innerHTML = allComments
                    .map(c => {
                        const isOwner = window.currentUser && c.user_id === window.currentUser.id;

                        return `
  <p>
    <span class="username">${c.username || "Anonymous"}:</span> ${c.comment}
    ${isOwner ? `
      <button class="edit-comment" data-id="${c.id}" data-comment='${encodeURIComponent(c.comment)}'>Edit</button>
      <button class="delete-comment" data-id="${c.id}">Delete</button>
    ` : ""}
  </p>
`;
                    })
                    .join("");

                allCommentsDiv.style.display = "block";
                expandBtn.textContent = "Hide all";
            } else {
                card.querySelector("p.comment").style.display = "block";
                allCommentsDiv.style.display = "none";
                expandBtn.textContent = "Show all";
            }
        });
    });

    currentPage = data.page;
    document.getElementById("prev-page").disabled = currentPage === 1;
    document.getElementById("next-page").disabled = currentPage === totalPages;
}

// =========================
// Load Page (with cache)
// =========================
async function loadPage(page = 1) {
    const container = document.getElementById("movie-list");

    if (pageCache[page]) {
        renderPage(pageCache[page]);
        return;
    }

    container.innerHTML = "<p>Loading movies...</p>";

    try {
        const res = await fetch(`/youlist/api/list?page=${page}`);
        if (!res.ok) throw new Error("Failed to fetch list");

        const data = await res.json();

        pageCache[page] = data;
        renderPage(data);

        // Preload next page
        if (page < data.totalPages && !pageCache[page + 1]) {
            fetch(`/youlist/api/list?page=${page + 1}`)
                .then(res => res.json())
                .then(nextData => pageCache[page + 1] = nextData)
                .catch(() => { });
        }

    } catch (err) {
        console.error("Load page error:", err);
        container.innerHTML = "<p>Failed to load movies — try refreshing.</p>";
    }
}

// =========================
// Pagination Buttons
// =========================
document.getElementById("prev-page")?.addEventListener("click", () => {
    if (currentPage > 1) loadPage(currentPage - 1);
});

document.getElementById("next-page")?.addEventListener("click", () => {
    if (currentPage < totalPages) loadPage(currentPage + 1);
});

// =========================
// Submit Comment
// =========================
document.getElementById("submit-comment")?.addEventListener("click", async () => {
    const tempCard = document.getElementById("temp-card");
    const commentBox = tempCard.querySelector("#temp-comment");
    const comment = commentBox.value.trim();

    if (!comment) return alert("Please enter a comment");

    const movie_id = tempCard.dataset.movieId;
    const type = tempCard.dataset.type;
    const editingId = tempCard.dataset.editingCommentId;

    try {
        let res;
        if (editingId) {
            // Edit existing comment
            res = await fetch(`/youlist/api/comment/${editingId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ comment })
            });
        } else {
            // Add new comment
            res = await fetch("/youlist/api/comment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ movie_id, type, comment })
            });
        }

        if (!res.ok) throw new Error("Network response not OK");
        const result = await res.json();
        if (!result.success) throw new Error(result.error);

        tempCard.style.display = "none";
        commentBox.value = "";
        delete tempCard.dataset.editingCommentId;

        window.location.reload(); // simple refresh to update the list

    } catch (err) {
        console.error("Comment submit error:", err);
        alert("Failed to submit comment");
    }
});

// =========================
// Initial Load
// =========================
loadPage(1);