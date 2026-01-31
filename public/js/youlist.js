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

/* =========================
   Submit Comment
========================= */
document.getElementById("submit-comment")?.addEventListener("click", async () => {
    const tempCard = document.getElementById("temp-card");
    const comment = tempCard.querySelector("#temp-comment").value.trim();

    if (!comment) return alert("Please enter a comment");

    const payload = {
        title: tempCard.querySelector("#temp-title").textContent,
        poster: tempCard.querySelector("#temp-poster").src,
        director: tempCard.querySelector("#temp-director").textContent.replace("Director: ", ""),
        year: tempCard.querySelector("#temp-year").textContent.replace("Year: ", ""),
        genre: tempCard.querySelector("#temp-genre").textContent.replace("Genre: ", ""),
        cast: tempCard.querySelector("#temp-cast").textContent.replace("Stars: ", ""),
        comment
    };

    const res = await fetch("/youlist/api/add-movie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    const result = await res.json();

    if (result.success) {
        alert("Added!");
        tempCard.style.display = "none";
    } else {
        alert(result.error || "Failed to add");
    }
});

let currentPage = 1;
let totalPages = 1; // updated from API
const pageCache = {}; // stores already-fetched pages for instant navigation

async function loadPage(page = 1) {
    // Check cache first
    let data = pageCache[page];
    if (!data) {
        const res = await fetch(`/youlist/api/list?page=${page}`);
        data = await res.json();
        pageCache[page] = data; // cache it
    }

    totalPages = data.totalPages;

    // Render movies
    const container = document.getElementById("movie-list");
    container.innerHTML = "";

    if (!data.results.length) {
        container.innerHTML = "<p>No movies to show.</p>";
        return;
    }

    data.results.forEach(movie => {
        const card = document.createElement("div");
        card.className = "movie-card";

        card.innerHTML = `
            <img src="${movie.poster}" alt="${movie.title}">
            <h3>${movie.title} (${movie.year || "N/A"})</h3>
            <p><strong>Director:</strong> ${movie.director}</p>
            <p><strong>Genre:</strong> ${movie.genre}</p>
            <p><strong>Stars:</strong> ${movie.cast}</p>
            <p class="comment">💬 ${movie.comment}</p>
        `;

        container.appendChild(card);
    });

    currentPage = page;

    // Enable/disable Prev/Next buttons
    document.getElementById("prev-page").disabled = currentPage === 1;
    document.getElementById("next-page").disabled = currentPage === totalPages;

    // Preload next page if it exists
    if (currentPage < totalPages && !pageCache[currentPage + 1]) {
        fetch(`/youlist/api/list?page=${currentPage + 1}`)
            .then(res => res.json())
            .then(nextData => { pageCache[currentPage + 1] = nextData; })
            .catch(() => { }); // ignore preload errors
    }
}


// Prev/Next button handlers
document.getElementById("prev-page").addEventListener("click", () => {
    if (currentPage > 1) loadPage(currentPage - 1);
});

document.getElementById("next-page").addEventListener("click", () => {
    if (currentPage < totalPages) loadPage(currentPage + 1);
});

// Initial load
loadPage(1);
