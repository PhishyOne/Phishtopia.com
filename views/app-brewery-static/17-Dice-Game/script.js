function roll() {
  return Math.floor(Math.random() * 6) + 1;
}

function imageName(playerRoll) {
  return "./images/dice" + playerRoll + ".png";
}

function winner(p1Roll, p2Roll) {
  if (p1Roll > p2Roll) {
    return "Player 1 Wins!";
  } else if (p1Roll < p2Roll) {
    return "Player 2 Wins!";
  } else {
    return "It's a Draw!";
  }
}

function rollDice() {
  var p1Roll = roll();
  var p2Roll = roll();

  document.querySelector("#player1").setAttribute("src", imageName(p1Roll));
  document.querySelector("#player2").setAttribute("src", imageName(p2Roll));
  document.querySelector("h2.result").innerHTML = winner(p1Roll, p2Roll);
}

document.querySelector("#rollButton").addEventListener("click", rollDice);
