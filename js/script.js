document.getElementById('play-video').addEventListener('click', function () {
    var video = document.getElementById('ash-birthday');
    video.style.display = 'block'; /* Show the video */
    video.play(); /* Play the video */
    video.muted = false; /* Enable audio */
    video.loop = true; /* Enable looping */
    this.style.display = 'none'; /* Hide the button */
});
