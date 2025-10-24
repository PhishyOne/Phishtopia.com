
const canvas = document.getElementById("gearCanvas");
canvas.width = 50;   // matches container
canvas.height = 50;
const ctx = canvas.getContext("2d");

const teeth = 12;
const canvasSize = Math.min(canvas.width, canvas.height);
const scale = canvasSize / 800; 

const outerRadius = 190 * scale;
const innerRadius = 140 * scale;
const holeRadius = 27 * scale;
const cutoutOuter = 90 * scale;
const cutoutInner = 50 * scale;

const centerX = canvas.width / 2.05;
const centerY = canvas.height / 3.5;

let angle = 0;
const speed = 0.01;

function drawGear(rot = 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rot);

    ctx.beginPath();
    const step = (2 * Math.PI) / teeth;
    const topFraction = 0.34;
    const gapFraction = 0.43;
    const degreeOffsetCutout = 15;
    const offsetCutout = degreeOffsetCutout * Math.PI / 180;

    for (let i = 0; i < teeth; i++) {
        const baseAngle = i * step;
        const mid = baseAngle + step / 2;
        const halfTop = (step * topFraction) / 2;
        const halfGap = (step * gapFraction) / 2;

        ctx.lineTo(Math.cos(baseAngle + halfGap) * innerRadius,
            Math.sin(baseAngle + halfGap) * innerRadius);
        ctx.lineTo(Math.cos(mid - halfTop) * outerRadius,
            Math.sin(mid - halfTop) * outerRadius);
        ctx.lineTo(Math.cos(mid + halfTop) * outerRadius,
            Math.sin(mid + halfTop) * outerRadius);
        ctx.lineTo(Math.cos(baseAngle + step - halfGap) * innerRadius,
            Math.sin(baseAngle + step - halfGap) * innerRadius);
    }
    ctx.closePath();

    // Center hole
    ctx.moveTo(holeRadius, 0);
    ctx.arc(0, 0, holeRadius, 0, Math.PI * 2, true);

    // Cutouts
    const cutoutAngle = 1.68;
    for (let i = 0; i < 3; i++) {
        const cutoutAngleBase = (i * (2 * Math.PI)) / 3;
        const start = (cutoutAngleBase - cutoutAngle / 2) + offsetCutout;
        const end = (cutoutAngleBase + cutoutAngle / 2) + offsetCutout;

        ctx.moveTo(Math.cos(start) * cutoutOuter, Math.sin(start) * cutoutOuter);
        ctx.arc(0, 0, cutoutOuter, start, end, false);
        ctx.arc(0, 0, cutoutInner, end, start, true);
        ctx.closePath();
    }

    // Shadow
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = 10 * scale;
    ctx.shadowOffsetX = 4 * scale;
    ctx.shadowOffsetY = 4 * scale;

    // Fill & stroke
    ctx.fillStyle = "rgba(241, 240, 233, 0.97)";
    ctx.fill("evenodd");
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2 * scale;
    ctx.stroke();

    ctx.restore();
}

function animate() {
    drawGear(angle);
    angle += speed;
    requestAnimationFrame(animate);
}

animate();
