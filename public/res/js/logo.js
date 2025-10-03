const canvas = document.getElementById("gearCanvas");
const ctx = canvas.getContext("2d");

const teeth = 12;
const scale = 0.56;
const outerRadius = 190 * scale;
const innerRadius = 140 * scale;
const holeRadius = 27 * scale;
const cutoutOuter = 90 * scale;
const cutoutInner = 50 * scale;
const cutoutAngle = 1.68;
const topFraction = 0.34;
const gapFraction = 0.43;
const degreeOffsetCutout = 15; // degrees
const step = (2 * Math.PI) / teeth;

// Center the origin at roughly your previous position
const centerX = canvas.width / 2.047;
const centerY = canvas.height / 3.1;

// Convert cutout offset to radians
const offsetCutout = degreeOffsetCutout * Math.PI / 180;

let angle = 0; // current rotation
const speed = 0.01; // radians per frame, adjust to rotate faster/slower

function drawGear(rot = 0) {
    ctx.clearRect(0, 0, canvas.width, canvas.height); // clear previous frame
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rot); // rotate gear

    ctx.beginPath();
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
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 4;

    // Fill & stroke
    ctx.fillStyle = "rgba(241, 240, 233, 0.97)"; // fully transparent fill
    ctx.fill("evenodd");
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
}

function animate() {
    drawGear(angle);
    angle += speed; // increment rotation
    requestAnimationFrame(animate);
}

animate();