
const canvas = document.querySelector('canvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const c = canvas.getContext('2d');
const numCircles = 100;

class Circle {
    constructor(x, y, dx, dy, radius, color = 'red') {
        this.x = x;
        this.y = y;
        this.dx = dx;
        this.dy = dy;
        this.radius = radius;
        this.color = color;
    }

    draw() {
        c.beginPath();
        c.arc(this.x, this.y, this.radius, 0, Math.PI * 2, false);
        c.strokeStyle = this.color;
        c.stroke();
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
