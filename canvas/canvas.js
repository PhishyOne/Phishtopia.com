
const canvas = document.querySelector('#bubble-canvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const c = canvas.getContext('2d');
var numCircles = 100;
var maxRadius = 40;
const minRadius = 2;
var colorArray = [
    '#ffaa33',
    '#99ffaa',
    '#00ff00',
    '#4411aa',
    '#ff1100'
];
var mouse = { x: undefined, y: undefined };

window.addEventListener('mousemove', function (event) {
    mouse.x = event.x;
    mouse.y = event.y;
});

class Circle {
    constructor(x, y, dx, dy, radius, color = 'red') {
        this.x = x;
        this.y = y;
        this.dx = dx;
        this.dy = dy;
        this.radius = radius;
        this.color = colorArray[Math.floor(Math.random() * colorArray.length)];;
    }

    draw() {
        c.beginPath();
        c.arc(this.x, this.y, this.radius, 0, Math.PI * 2, false);
        // c.strokeStyle = this.color;
        // c.stroke();
        c.fillStyle = this.color;
        c.fill();
    }

    update() {
        if (this.x + this.radius > innerWidth || this.x - this.radius < 0) {
            this.dx = -this.dx;
        }
        if (this.y + this.radius > innerHeight || this.y - this.radius < 0) {
            this.dy = -this.dy;
        }
        this.x += this.dx;
        this.y += this.dy;

        if(mouse.x - this.x < 50 && mouse.x - this.x > -50 && mouse.y - this.y < 50 && mouse.y - this.y > -50) {
            if (this.radius < maxRadius) {
                this.radius += 1;
            }
        } else if (this.radius > minRadius) {
            this.radius -= 1;
        } 

        this.draw();
    }
}

const circleArray = [];
for (let i = 0; i < numCircles; i++) {
    const radius = Math.random() * 15 + 2;
    const x = Math.random() * (innerWidth - radius * 2) + radius;
    const y = Math.random() * (innerHeight - radius * 2) + radius;
    const dx = (Math.random() - 0.5) * 3;
    const dy = (Math.random() - 0.5) * 3;
    const alpha = Math.random() * 0.8;
    const color = `rgba(${Math.floor(Math.random() * 10)},
                        ${Math.floor(Math.random() * 25)},
                        ${Math.floor(Math.random() * 255)}, ${alpha.toFixed(1)})`;

    circleArray.push(new Circle(x, y, dx, dy, radius, color));
}




function animate() {
    requestAnimationFrame(animate);
    c.clearRect(0, 0, innerWidth, innerHeight);
    for (const circle of circleArray) {
        circle.update();
    }
}

animate();
