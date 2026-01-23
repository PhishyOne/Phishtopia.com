// Temporary card container in your HTML
// <section class="movielist-section temporary" id="temp-card" style="display:none"> ... </section>

const input = document.querySelector(".search-input");
const wrapper = input.closest(".search-wrapper");

const dropdown = document.createElement("ul");
dropdown.className = "autocomplete-dropdown";
wrapper.appendChild(dropdown);
if (!dropdown.parentNode) input.parentNode.appendChild(dropdown);

let timer;
const MIN_CHARS = 2;

// Placeholder HTML
const placeholderItem = `
  <li class="autocomplete-item placeholder">
    <img src="/project34/images/placeholder.png" class="autocomplete-poster">
    <span class="autocomplete-title">Start typing to search...</span>
  </li>
`;

// ----------------------------
// Render autocomplete results
async function renderResults(query) {
    dropdown.innerHTML = `<li class="close-dropdown">✕</li>`;

    if (!query || query.length < MIN_CHARS) {
        dropdown.style.display = "none";
        return;
    }

    try {
        const res = await fetch(`/youlist/api/search?q=${encodeURIComponent(query)}`);
        const results = await res.json();
        const queryRegex = new RegExp(`(${query})`, "i");

        if (!results.length) {
            dropdown.innerHTML += placeholderItem;
        } else {
            const itemsHTML = results
                .map(item => {
                    const highlightedTitle = item.title.replace(queryRegex, "<b>$1</b>");
                    return `
            <li class="autocomplete-item" data-id="${item.id}">
              <img src="${item.poster || '/project34/images/placeholder.png'}" 
                   alt="${item.title}" class="autocomplete-poster">
              <span class="autocomplete-title">${highlightedTitle} (${item.year || 'N/A'})</span>
              <span class="autocomplete-type">${item.type === 'movie' ? '🎬' : '📺'}</span>
            </li>
          `;
                }).join("");

            dropdown.innerHTML += itemsHTML;
        }

        dropdown.style.display = "block";
    } catch (err) {
        console.error(err);
        dropdown.innerHTML += placeholderItem;
        dropdown.style.display = "block";
    }
}

// ----------------------------
// Input typing (debounced)
input.addEventListener("input", () => {
    clearTimeout(timer);
    const query = input.value.trim();

    if (query.length < MIN_CHARS) {
        dropdown.style.display = "none";
        return;
    }

    timer = setTimeout(() => renderResults(query), 300);
});

// ----------------------------
// Clear input
document.querySelector(".clear-input")?.addEventListener("click", () => {
    input.value = "";
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
    input.focus();
});

// ----------------------------
// Close dropdown
dropdown.addEventListener("click", e => {
    if (e.target.classList.contains("close-dropdown")) {
        dropdown.style.display = "none";
    }
});

// ----------------------------
// Click movie from autocomplete
dropdown.addEventListener("click", async e => {
    const item = e.target.closest(".autocomplete-item");
    if (!item || item.classList.contains("placeholder")) return;

    const movieId = item.dataset.id;

    // Hide dropdown
    dropdown.style.display = "none";

    // Fetch detailed info from TMDB
    const res = await fetch(`/youlist/api/movie/${movieId}`);
    const movie = await res.json();

    // Fill temporary card
    const tempCard = document.getElementById("temp-card");
    tempCard.querySelector("#temp-title").textContent = movie.title;
    tempCard.querySelector("#temp-poster").src = movie.poster;
    tempCard.querySelector("#temp-director").textContent = `Director: ${movie.director || 'N/A'}`;
    tempCard.querySelector("#temp-year").textContent = `Release Year: ${movie.year || 'N/A'}`;
    tempCard.querySelector("#temp-genre").textContent = `Genre: ${movie.genre || 'N/A'}`;
    tempCard.querySelector("#temp-cast").textContent = `Stars: ${movie.cast || 'N/A'}`;

    // Show comment section and card
    tempCard.style.display = "grid";

    // Clear previous comment
    tempCard.querySelector("#temp-comment").value = "";
});

// ----------------------------
// Cancel comment
document.getElementById("cancel-comment").addEventListener("click", () => {
    document.getElementById("temp-card").style.display = "none";
    // Keep search input value unchanged
});

// ----------------------------
// Submit comment
document.getElementById("submit-comment").addEventListener("click", async () => {
    const comment = document.getElementById("temp-comment").value.trim();
    if (!comment) return alert("Please enter a comment");

    const tempCard = document.getElementById("temp-card");
    const movieTitle = tempCard.querySelector("#temp-title").textContent;
    const poster = tempCard.querySelector("#temp-poster").src;
    const director = tempCard.querySelector("#temp-director").textContent.replace('Director: ', '');
    const year = tempCard.querySelector("#temp-year").textContent.replace('Release Year: ', '');
    const genre = tempCard.querySelector("#temp-genre").textContent.replace('Genre: ', '');
    const cast = tempCard.querySelector("#temp-cast").textContent.replace('Stars: ', '');

    const payload = { title: movieTitle, poster, director, year, genre, cast, comment };

    const res = await fetch('/youlist/api/add-movie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (result.success) {
        alert("Movie/comment added!");
        tempCard.style.display = "none";
        document.getElementById("temp-comment").value = "";
        // optionally refresh movie list
    } else {
        alert(result.error);
    }
});
