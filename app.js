const video = document.querySelector("#webcam");
const stage = document.querySelector(".stage");
const overlay = document.querySelector("#overlay");
const startButton = document.querySelector("#startButton");
const cameraStatus = document.querySelector("#cameraStatus");
const handStatus = document.querySelector("#handStatus");
const pinchStatus = document.querySelector("#pinchStatus");

const fingerConnections = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [5, 9],
  [9, 13],
  [13, 17],
];

let camera;
let latestHands = [];
let latestPinching = false;
let indexTrail = [];
let fireworks = [];
let palmWasOpen = false;
let replayTrail = [];
let replayProgress = 0;
let isReplayingTrail = false;
let cooldownUntil = 0;

const maxTrailPoints = 50;
const cooldownMs = 2000;

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function updateStatus() {
  handStatus.textContent = String(latestHands.length);
  pinchStatus.textContent = latestPinching ? "on" : "off";
  pinchStatus.style.color = latestPinching ? "#38d979" : "#f4f7fb";
}

function onResults(results) {
  latestHands = results.multiHandLandmarks ?? [];
  updateStatus();
}

function createP5Renderer() {
  return new p5((sketch) => {
    function resizeSketch() {
      const rect = stage.getBoundingClientRect();
      sketch.resizeCanvas(Math.round(rect.width), Math.round(rect.height));
    }

    function toSketchPoint(landmark) {
      return {
        x: (1 - landmark.x) * sketch.width,
        y: landmark.y * sketch.height,
      };
    }

    function drawLine(from, to, color = "rgba(255, 255, 255, 0.8)", width = 4) {
      sketch.stroke(color);
      sketch.strokeWeight(width);
      sketch.strokeCap(sketch.ROUND);
      sketch.line(from.x, from.y, to.x, to.y);
    }

    function drawLandmark(point, index) {
      const radius = Math.max(5, sketch.width * 0.006);
      const fontSize = Math.max(13, sketch.width * 0.014);

      sketch.stroke("#071018");
      sketch.strokeWeight(2);
      sketch.fill("#57b8ff");
      sketch.circle(point.x, point.y, radius * 2);

      sketch.textAlign(sketch.CENTER, sketch.CENTER);
      sketch.textSize(fontSize);
      sketch.strokeWeight(4);
      sketch.stroke("rgba(0, 0, 0, 0.72)");
      sketch.fill("#ffffff");
      sketch.text(String(index), point.x, point.y - radius - 10);
    }

    function drawPinchFeedback(thumb, index) {
      const center = {
        x: (thumb.x + index.x) / 2,
        y: (thumb.y + index.y) / 2,
      };
      const radius = Math.max(24, sketch.width * 0.035);

      sketch.stroke("#38d979");
      sketch.strokeWeight(5);
      sketch.fill("rgba(56, 217, 121, 0.24)");
      sketch.circle(center.x, center.y, radius * 2);
    }

    function averagePoint(points, indexes) {
      const total = indexes.reduce(
        (sum, index) => ({
          x: sum.x + points[index].x,
          y: sum.y + points[index].y,
        }),
        { x: 0, y: 0 },
      );

      return {
        x: total.x / indexes.length,
        y: total.y / indexes.length,
      };
    }

    function isFingerExtended(points, tipIndex, pipIndex, minRatio = 1.18) {
      const wrist = points[0];
      return (
        distance(wrist, points[tipIndex]) >
        distance(wrist, points[pipIndex]) * minRatio
      );
    }

    function isIndexExtended(points) {
      return isFingerExtended(points, 8, 6, 1.18);
    }

    function isPalmOpen(points) {
      const palmSize = distance(points[0], points[9]);
      const palmCenter = averagePoint(points, [0, 5, 9, 13, 17]);
      const fingertips = [4, 8, 12, 16, 20];
      const openTips = fingertips.filter(
        (index) => distance(palmCenter, points[index]) > palmSize * 0.82,
      );

      return openTips.length >= 5;
    }

    function rememberIndexPoint(point) {
      const previous = indexTrail[indexTrail.length - 1];

      if (previous && distance(previous, point) < 8) {
        return;
      }

      indexTrail.push({ x: point.x, y: point.y });

      if (indexTrail.length > maxTrailPoints) {
        indexTrail.shift();
      }
    }

    function drawIndexTrail() {
      drawCurvedTrail(indexTrail, indexTrail.length);
    }

    function drawCurvedTrail(points, visibleCount) {
      const visiblePoints = points.slice(0, visibleCount);

      if (visiblePoints.length < 2) {
        return;
      }

      sketch.noFill();
      sketch.strokeCap(sketch.ROUND);
      sketch.strokeJoin(sketch.ROUND);

      sketch.stroke("rgba(39, 232, 255, 0.18)");
      sketch.strokeWeight(18);
      sketch.beginShape();
      sketch.curveVertex(visiblePoints[0].x, visiblePoints[0].y);
      for (const point of visiblePoints) {
        sketch.curveVertex(point.x, point.y);
      }
      sketch.curveVertex(
        visiblePoints[visiblePoints.length - 1].x,
        visiblePoints[visiblePoints.length - 1].y,
      );
      sketch.endShape();

      sketch.stroke("rgba(255, 255, 255, 0.72)");
      sketch.strokeWeight(5);
      sketch.beginShape();
      sketch.curveVertex(visiblePoints[0].x, visiblePoints[0].y);
      for (const point of visiblePoints) {
        sketch.curveVertex(point.x, point.y);
      }
      sketch.curveVertex(
        visiblePoints[visiblePoints.length - 1].x,
        visiblePoints[visiblePoints.length - 1].y,
      );
      sketch.endShape();

      for (let index = 0; index < visiblePoints.length; index += 1) {
        const point = visiblePoints[index];
        const alpha = sketch.map(index, 0, visiblePoints.length - 1, 50, 210);

        sketch.noStroke();
        sketch.fill(56, 217, 121, alpha);
        sketch.circle(point.x, point.y, 5);
      }
    }

    function createFirework(origin) {
      const colors = [
        [56, 217, 121],
        [87, 184, 255],
        [255, 191, 95],
        [255, 99, 146],
        [255, 255, 255],
      ];

      for (let index = 0; index < 78; index += 1) {
        const angle = sketch.random(sketch.TWO_PI);
        const speed = sketch.random(2.2, 8.5);
        const color = sketch.random(colors);

        fireworks.push({
          x: origin.x,
          y: origin.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: sketch.random(34, 62),
          maxLife: 62,
          size: sketch.random(3, 8),
          color,
        });
      }
    }

    function drawFireworks() {
      for (let index = fireworks.length - 1; index >= 0; index -= 1) {
        const particle = fireworks[index];
        const alpha = sketch.map(particle.life, 0, particle.maxLife, 0, 230);

        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vx *= 0.96;
        particle.vy = particle.vy * 0.96 + 0.05;
        particle.life -= 1;

        sketch.noStroke();
        sketch.fill(
          particle.color[0],
          particle.color[1],
          particle.color[2],
          alpha,
        );
        sketch.circle(particle.x, particle.y, particle.size);

        if (particle.life <= 0) {
          fireworks.splice(index, 1);
        }
      }
    }

    function drawHand(landmarks) {
      const points = landmarks.map(toSketchPoint);
      const palmCenter = averagePoint(points, [0, 5, 9, 13, 17]);

      for (const [fromIndex, toIndex] of fingerConnections) {
        drawLine(points[fromIndex], points[toIndex]);
      }

      for (let index = 0; index < points.length; index += 1) {
        drawLandmark(points[index], index);
      }

      const thumbTip = points[4];
      const indexTip = points[8];
      const palmSize = distance(points[0], points[9]);
      const pinchDistance = distance(thumbTip, indexTip);
      const isPinching = pinchDistance < palmSize * 0.52;

      if (isPinching) {
        drawPinchFeedback(thumbTip, indexTip);
      }

      return {
        isPinching,
        indexTip,
        indexExtended: isIndexExtended(points),
        palmCenter,
        palmOpen: isPalmOpen(points),
      };
    }

    function startTrailReplay() {
      replayTrail = indexTrail.map((point) => ({ x: point.x, y: point.y }));
      replayProgress = 1;
      isReplayingTrail = true;
      indexTrail = [];
    }

    function drawReplayTrail() {
      if (replayTrail.length < 2) {
        return;
      }

      const visibleCount = Math.min(Math.ceil(replayProgress), replayTrail.length);

      drawCurvedTrail(replayTrail, visibleCount);

      if (!isReplayingTrail) {
        return;
      }

      replayProgress += 0.28;

      if (replayProgress >= replayTrail.length) {
        const fingertip = replayTrail[replayTrail.length - 1];

        isReplayingTrail = false;
        replayProgress = replayTrail.length;
        createFirework(fingertip);
        cooldownUntil = sketch.millis() + cooldownMs;
      }
    }

    sketch.setup = () => {
      const rect = stage.getBoundingClientRect();
      const canvas = sketch.createCanvas(Math.round(rect.width), Math.round(rect.height));

      canvas.parent(overlay);
      sketch.clear();
    };

    sketch.draw = () => {
      sketch.clear();
      latestPinching = false;
      let indexVisible = false;
      let palmOpen = false;
      const canRecord = !isReplayingTrail && sketch.millis() >= cooldownUntil;

      for (const landmarks of latestHands) {
        const handState = drawHand(landmarks);

        latestPinching = handState.isPinching || latestPinching;

        if (!indexVisible && handState.indexExtended) {
          indexVisible = true;

          if (canRecord) {
            rememberIndexPoint(handState.indexTip);
          }
        }

        if (!palmOpen && handState.palmOpen) {
          palmOpen = true;
        }
      }

      if (!indexVisible && canRecord) {
        indexTrail = [];
      }

      if (palmOpen && !palmWasOpen && canRecord && indexTrail.length >= 2) {
        startTrailReplay();
      }

      palmWasOpen = palmOpen;

      if (isReplayingTrail || replayTrail.length >= 2) {
        drawReplayTrail();
      } else {
        drawIndexTrail();
      }

      drawFireworks();

      if (!isReplayingTrail && cooldownUntil > 0 && sketch.millis() >= cooldownUntil) {
        replayTrail = [];
        replayProgress = 0;
        cooldownUntil = 0;
      }

      updateStatus();
    };

    sketch.windowResized = resizeSketch;
  });
}

async function startCamera() {
  startButton.disabled = true;
  startButton.textContent = "Starting";
  cameraStatus.textContent = "starting";

  const hands = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.6,
  });

  hands.onResults(onResults);

  camera = new Camera(video, {
    onFrame: async () => {
      await hands.send({ image: video });
    },
    width: 1280,
    height: 720,
  });

  try {
    await camera.start();
    cameraStatus.textContent = "running";
    startButton.textContent = "Webcam Running";
  } catch (error) {
    cameraStatus.textContent = "blocked";
    startButton.disabled = false;
    startButton.textContent = "Restart Webcam";
    console.error(error);
  }
}

createP5Renderer();
startButton.addEventListener("click", startCamera);
