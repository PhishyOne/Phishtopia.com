
const input = document.querySelector(".search-input");
const dropdown = document.createElement("ul");
dropdown.className = "autocomplete-dropdown";
input.parentNode.appendChild(dropdown);

let timer;

input.addEventListener("input", () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < 2) {
        dropdown.innerHTML = "";
        return;
    }

    timer = setTimeout(async () => {
        try {
            const res = await fetch(`/youlist/api/search?q=${encodeURIComponent(query)}`);
            const results = await res.json();
            const queryRegex = new RegExp(`(${query})`, "i");

            dropdown.innerHTML = results
                .map(item => {
                    // Bold matching part
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
        } catch (err) {
            console.error(err);
        }
    }, 300);
});
