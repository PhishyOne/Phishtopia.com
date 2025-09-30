var canvas = document.querySelector('canvas');

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

var c = canvas.getContext('2d');

c.fillRect(100, 100, 100, 100);
c.fillStyle = 'blue';
c.fillRect(400, 100, 100, 100);
c.fillStyle = 'pink';
c.fillRect(300, 300, 100, 100);

/*
c.beginPath();
c.moveTo(50, 300);
c.lineTo(300, 100);
c.lineTo(400, 300);
c.strokeStyle = "purple";
c.stroke();
*/

c.beginPath();
c.arc(300, 300, 20, 0, Math.PI * 2, false);
c.strokeStyle = 'green';
c.stroke();

for (var i = 0; i < 100; i++) {
    var x = Math.random() * window.innerWidth;
    var y = Math.random() * window.innerHeight;
    c.beginPath();
    c.arc(x, y, 10, 0, Math.PI * 2, false);
    c.strokeStyle = 'rgba(' + Math.floor(Math.random() * 255) + ',' + Math.floor(Math.random() * 255) + ',' + Math.floor(Math.random() * 255) + ',0.5)';
    c.stroke();
}