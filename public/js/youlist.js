const input = document.querySelector(".search-input");
const wrapper = input.closest(".search-wrapper");

const dropdown = document.createElement("ul");
dropdown.className = "autocomplete-dropdown";
wrapper.appendChild(dropdown);

let timer;
const MIN_CHARS = 2;

/* =========================
   Placeholder Item
========================= */
const placeholderItem = `
  <li class="autocomplete-item placeholder">
    <img src="/project34/images/placeholder.png" class="autocomplete-poster">
    <span class="autocomplete-title">Start typing to search...</span>
  </li>
`;

/* =========================
   Render Autocomplete
========================= */
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
            const regex = new RegExp(`(${query})`, "i");
            dropdown.innerHTML += results
                .map(item => {
                    const title = item.title.replace(regex, "<b>$1</b>");
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
                })
                .join("");
        }

        dropdown.style.display = "block";
    } catch (err) {
        console.error("Autocomplete error:", err);
        dropdown.innerHTML += placeholderItem;
        dropdown.style.display = "block";
    }
}

/* =========================
   Input (Debounced)
========================= */
input.addEventListener("input", () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < MIN_CHARS) {
        dropdown.style.display = "none";
        return;
    }
    timer = setTimeout(() => renderResults(query), 300);
});

/* =========================
   Clear Input
========================= */
document.querySelector(".clear-input")?.addEventListener("click", () => {
    input.value = "";
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
    input.focus();
});

/* =========================
   Close Dropdown
========================= */
dropdown.addEventListener("click", e => {
    if (e.target.classList.contains("close-dropdown")) {
        dropdown.style.display = "none";
    }
});

/* =========================
   Select Item
========================= */
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
        tempCard.querySelector("#temp-comment").value = "";
        tempCard.style.display = "grid";
    } catch (err) {
        console.error("Item fetch error:", err);
    }
});

/* =========================
   Cancel Comment
========================= */
document.getElementById("cancel-comment")?.addEventListener("click", () => {
    document.getElementById("temp-card").style.display = "none";
});

let currentPage = 1;
let totalPages = 1;
const pageCache = {}; // stores fetched pages

/* =========================
   Render a page of movies
========================= */
async function loadPage(page = 1) {
    let data = pageCache[page];
    if (!data) {
        const res = await fetch(`/youlist/api/list?page=${page}`);
        data = await res.json();
        pageCache[page] = data;
    }

    totalPages = data.totalPages;
    const container = document.getElementById("movie-list");
    container.innerHTML = "";

    if (!data.results.length) {
        container.innerHTML = "<p>No movies to show.</p>";
        return;
    }

    data.results.forEach(movie => {
        const card = document.createElement("div");
        card.className = "movie-card";
        card.dataset.movieId = movie.id;
        card.dataset.type = movie.type;
        card.dataset.comments = JSON.stringify(movie.comments || []);

        const latestComment = movie.comments?.[0]?.comment || "No comments yet";

        card.innerHTML = `
            <img src="${movie.poster}" alt="${movie.title}">
            <h3>${movie.title} (${movie.year || "N/A"})</h3>
            <p><strong>Director:</strong> ${movie.director}</p>
            <p><strong>Genre:</strong> ${movie.genre}</p>
            <p><strong>Stars:</strong> ${movie.cast}</p>
            <p class="comment">💬 ${latestComment}</p>
            <button class="expand-comments">Show all</button>
            <div class="all-comments" style="display:none;"></div>
        `;

        container.appendChild(card);

        // Expand button
        const expandBtn = card.querySelector(".expand-comments");
        const allCommentsDiv = card.querySelector(".all-comments");
        expandBtn.addEventListener("click", () => {
            const allComments = JSON.parse(card.dataset.comments);
            if (allCommentsDiv.style.display === "none") {
                allCommentsDiv.innerHTML = allComments
                    .map(c => `<p>💬 ${c.comment}</p>`)
                    .join("");
                allCommentsDiv.style.display = "block";
                expandBtn.textContent = "Hide all";
            } else {
                allCommentsDiv.style.display = "none";
                expandBtn.textContent = "Show all";
            }
        });
    });

    currentPage = page;
    document.getElementById("prev-page").disabled = currentPage === 1;
    document.getElementById("next-page").disabled = currentPage === totalPages;

    // Preload next page
    if (currentPage < totalPages && !pageCache[currentPage + 1]) {
        fetch(`/youlist/api/list?page=${currentPage + 1}`)
            .then(res => res.json())
            .then(nextData => { pageCache[currentPage + 1] = nextData; })
            .catch(() => { });
    }
}

/* =========================
   Prev/Next navigation
========================= */
document.getElementById("prev-page").addEventListener("click", () => {
    if (currentPage > 1) loadPage(currentPage - 1);
});
document.getElementById("next-page").addEventListener("click", () => {
    if (currentPage < totalPages) loadPage(currentPage + 1);
});

/* =========================
   Submit Comment (Unified)
========================= */
document.getElementById("submit-comment")?.addEventListener("click", async () => {
    const tempCard = document.getElementById("temp-card");
    const comment = tempCard.querySelector("#temp-comment").value.trim();
    if (!comment) return alert("Please enter a comment");

    const movie_id = tempCard.dataset.movieId;
    const type = tempCard.dataset.type;
    const payload = { movie_id, type, comment };

    try {
        const res = await fetch("/youlist/api/comment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (!result.success) throw new Error(result.error || "Failed to add");

        // Hide temp card
        tempCard.style.display = "none";
        tempCard.querySelector("#temp-comment").value = "";

        // Update movie card UI immediately
        const movieCard = document.querySelector(`.movie-card[data-movie-id="${movie_id}"][data-type="${type}"]`);
        if (movieCard) {
            const existingComments = JSON.parse(movieCard.dataset.comments || "[]");
            const newComments = [{ comment }, ...existingComments];
            movieCard.dataset.comments = JSON.stringify(newComments);
            movieCard.querySelector(".comment").textContent = `💬 ${comment}`;

            // Update expanded comments if visible
            const allCommentsDiv = movieCard.querySelector(".all-comments");
            if (allCommentsDiv.style.display === "block") {
                allCommentsDiv.innerHTML = newComments.map(c => `<p>💬 ${c.comment}</p>`).join("");
            }
        }

        // Refresh first page cache
        Object.keys(pageCache).forEach(k => delete pageCache[k]);
        loadPage(1);
    } catch (err) {
        console.error("Add comment error:", err);
        alert("Failed to add comment");
    }
});

// Initial page load
loadPage(1);
