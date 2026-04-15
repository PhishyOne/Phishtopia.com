const password = document.getElementById("password");
const confirm = document.getElementById("confirm-password");
const matchText = document.getElementById("password-match");

function checkMatch() {
    if (!confirm.value) {
        matchText.textContent = "";
        return;
    }

    if (password.value === confirm.value) {
        matchText.textContent = "Passwords match";
        matchText.style.color = "green";
    } else {
        matchText.textContent = "Passwords do not match";
        matchText.style.color = "red";
    }
}

password.addEventListener("input", checkMatch);
confirm.addEventListener("input", checkMatch);

function validatePasswords() {
    const password = document.getElementById("password").value;
    const confirm = document.getElementById("confirm-password").value;
    const errorBox = document.getElementById("error-box");

    if (password !== confirm) {
        errorBox.innerText = "Passwords do not match";
        errorBox.style.display = "block";
        return false;
    }

    errorBox.style.display = "none";
    return true;
}