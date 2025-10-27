
function updateUTCTime() {
    const now = new Date();
    const utcTime = now.toUTCString().split(' ')[4] + ' UTC';
    const el = document.getElementById('utc-time');
    if (el) el.textContent = utcTime;
}

document.addEventListener('DOMContentLoaded', () => {
    updateUTCTime();
    setInterval(updateUTCTime, 1000);
});
