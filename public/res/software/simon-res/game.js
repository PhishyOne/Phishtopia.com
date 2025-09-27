// Constants and Variables
const buttonColors = ["red", "blue", "green", "yellow"];
const soundFiles = {
  red: "/res/software/simon-res/red.mp3",
  blue: "/res/software/simon-res/blue.mp3",
  green: "/res/software/simon-res/green.mp3",
  yellow: "/res/software/simon-res/yellow.mp3",
  wrong: "/res/software/simon-res/wrong.mp3",
};

let gamePattern = [];
let userClickedPattern = [];
let level = 0;
let sounds = {};
let started = false;

// Preload sounds
for (const sound in soundFiles) {
  sounds[sound] = new Audio(soundFiles[sound]);
  sounds[sound].preload = 'auto';
}

// Function for playing sounds
function playSound(name) {
  sounds[name].currentTime = 0;
  sounds[name].play();
}

function nextSequence() {
  // Generate a random number between 0 and 3
  let randomNumber = Math.floor((Math.random() * 4));
  // Select a random color
  let randomChosenColor = buttonColors[randomNumber];
  // Add each randomChosenColor to gamePattern
  gamePattern.push(randomChosenColor);
  // Select the button with the same id as the randomChosenColor
  $("#" + randomChosenColor).fadeIn(100).fadeOut(100).fadeIn(100);
  // Play the corresponding sound
  playSound(randomChosenColor);
  // Update the h2 with the new level
  $("#level-title").text("Level " + level);
  // Increase the level by 1
  level++;
}

function animatePress(currentColor) {
  $("#" + currentColor).addClass("pressed");
  setTimeout(function () {
    $("#" + currentColor).removeClass("pressed");
  }, 100);
}

function checkAnswer(currentLevel) {
  if (gamePattern[currentLevel] === userClickedPattern[currentLevel]) {
    console.log("success");
    if (userClickedPattern.length === gamePattern.length) {
      userClickedPattern = [];
      setTimeout(function () {
        nextSequence();
      }, 1000);
    }
  } else {
    console.log("wrong");
    playSound("wrong");
    $("body").addClass("game-over");
    setTimeout(function () {
      $("body").removeClass("game-over");
    }, 200);
    $("#level-title").text("Game Over, Press Start to Play Again");
    startOver();
  }
  console.log("User " + userClickedPattern);
  console.log("Game " + gamePattern);
}

function startOver() {
  gamePattern = [];
  userClickedPattern = [];
  started = false;
  $("#level-title").text("Press Start");
}

// Detect when a button is clicked
$(".simon-btn").click(function () {
  if (started) {
    // Store the id of the button that got clicked
    let userChosenColor = $(this).attr("id");
    // Add the contents of userChosenColor to a new array called userClickedPattern
    userClickedPattern.push(userChosenColor);
    // Play sound for the button that got clicked
    playSound(userChosenColor);
    animatePress(userChosenColor);
    checkAnswer(userClickedPattern.length - 1);
  }
});

// Detect if Start Button has been pressed for the first time
$(document).keydown(function () {
  if (!started) {
    start();
  }
});

$(".start-button").click(function () {
  if (!started) {
    start();
  } else {
    startOver();
    start();
  }
});

function start() {
  started = true;
  level = 1;
  $("#level-title").text("Level " + level);
  nextSequence();
}
