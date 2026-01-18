
const buttons = document.querySelectorAll("button");
let currentKey;

const soundMap = {
    "w": "kick-bass",
    "a": "snare",
    "s": "tom-1",
    "d": "tom-2",
    "j": "tom-3",
    "k": "tom-4",
    "l": "crash"
};

const sounds = {};

function preloadSounds() {
    const soundNames = Object.values(soundMap);
    soundNames.forEach(name => {
        sounds[name] = new Audio(`./sounds/${name}.mp3`);
    });
}

function playSound(drum) {
    if (sounds[drum]) {
        sounds[drum].currentTime = 0;
        sounds[drum].play();
    }
}

function buttonAnimation(currentKey) {
    const activeButton = document.querySelector(`.${currentKey}`);
    if (activeButton) {
        activeButton.classList.add("pressed");
        setTimeout(() => {
            activeButton.classList.remove("pressed");
        }, 100);
    }
}

function whichSound(key) {
    const sound = soundMap[key];
    if (sound) {
        playSound(sound);
    }
}

function checkKey() {
    document.addEventListener("keydown", (event) => {
        if (Object.keys(soundMap).includes(event.key)) {
            whichSound(event.key);
            currentKey = event.key;
            buttonAnimation(currentKey);
        }
    });
}

preloadSounds();

for (let i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener("click", function () {
        var buttonInnerHTML = this.innerHTML;
        whichSound(buttonInnerHTML);
        currentKey = buttonInnerHTML;
        buttonAnimation(currentKey);
    });
}

checkKey();