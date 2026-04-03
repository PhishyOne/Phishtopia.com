// =====================
// Canvas Setup
// =====================
const canvas = document.querySelector('#bubble-canvas');
const c = canvas.getContext('2d');

let cw = window.innerWidth;
let ch = window.innerHeight;
canvas.width = cw;
canvas.height = ch;

// Resize handler
window.addEventListener('resize', () => {
    cw = window.innerWidth;
    ch = window.innerHeight;
    canvas.width = cw;
    canvas.height = ch;
});

// =====================
// Circle Class
// =====================
class Circle {
    constructor(x, y, dx, dy, radius, color) {
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
        if (this.x + this.radius > cw || this.x - this.radius < 0) this.dx = -this.dx;
        if (this.y + this.radius > ch || this.y - this.radius < 0) this.dy = -this.dy;

        this.x += this.dx;
        this.y += this.dy;
        this.draw();
    }
}

// =====================
// Initialize Circles
// =====================
const numCircles = 50; // Reduced for performance
const circleArray = [];

for (let i = 0; i < numCircles; i++) {
    const radius = Math.random() * 15 + 2;
    const x = Math.random() * (cw - radius * 2) + radius;
    const y = Math.random() * (ch - radius * 2) + radius;
    const dx = (Math.random() - 0.5) * 2; // slightly slower
    const dy = (Math.random() - 0.5) * 2;
    const alpha = Math.random() * 0.7 + 0.2; // visible alpha
    const color = `rgba(${Math.floor(Math.random() * 50)},
                        ${Math.floor(Math.random() * 50)},
                        ${Math.floor(Math.random() * 255)}, ${alpha.toFixed(2)})`;

    circleArray.push(new Circle(x, y, dx, dy, radius, color));
}

// =====================
// Animation Loop
// =====================
let frame = 0;
function animate() {
    requestAnimationFrame(animate);
    frame++;

    // Optional: skip every other frame to reduce CPU
    if (frame % 2 === 0) return;

    c.clearRect(0, 0, cw, ch);

    for (const circle of circleArray) {
        circle.update();
    }
}

// Start animation
animate();
