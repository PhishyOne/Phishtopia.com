const input = document.querySelector(".search-input");
const dropdown = document.createElement("ul");
dropdown.className = "autocomplete-dropdown";
input.parentNode.appendChild(dropdown);

const clearBtn = document.querySelector(".clear-input");
let timer;

const MIN_CHARS = 2;

// ----------------------------
// Placeholder HTML
const placeholderItem = `
  <li class="autocomplete-item placeholder">
    <img src="/project34/images/placeholder.png" class="autocomplete-poster">
    <span class="autocomplete-title">Start typing to search...</span>
  </li>
`;

// ----------------------------
// Render results
async function renderResults(query) {
    // Always add close button at the top
    dropdown.innerHTML = `<li class="close-dropdown">✕</li>`;

    if (!query || query.length < MIN_CHARS) {
        // Don't show placeholder yet
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

        dropdown.style.display = "block"; // show dropdown now
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
// Clear input button
clearBtn.addEventListener("click", () => {
    input.value = "";
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
    input.focus();
});

// ----------------------------
// Close button
dropdown.addEventListener("click", e => {
    if (e.target.classList.contains("close-dropdown")) {
        dropdown.style.display = "none";
    }
});

// ----------------------------
// Initial state
dropdown.style.display = "none"; // hide on page load
