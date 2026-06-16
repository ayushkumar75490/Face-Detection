const CAPTURE_WIDTH = 640;
const CAPTURE_HEIGHT = 360;
let video;
let overlay;
let overlayCtx;
let detectionInterval;
let lastFrameTime = performance.now();
let isFacePauseActive = false;
let facePauseTimeout = null;
let detectionSound = null;

async function startCamera() {

    video = document.getElementById("video");
    if (!video) {
        console.error("Video element not found");
        return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showCameraMessage('Camera access is not supported by your browser.', true);
        return;
    }

    showCameraMessage('Requesting camera access... Please allow camera permission in your browser.', false);

    try {

        const stream =
            await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: CAPTURE_WIDTH },
                    height: { ideal: CAPTURE_HEIGHT },
                    facingMode: 'user'
                }
            });

        video.srcObject = stream;

        video.onloadedmetadata = () => {

            overlay =
                document.getElementById("overlay");

            overlay.width = CAPTURE_WIDTH;
            overlay.height = CAPTURE_HEIGHT;

            overlay.style.width =
                video.offsetWidth + "px";

            overlay.style.height =
                video.offsetHeight + "px";

            overlayCtx =
                overlay.getContext("2d");

            addLog("Camera Started");
            showCameraMessage('Camera access granted. Starting camera...', false);
            showRetryButton(false);

            const snapshotBtn = document.getElementById('snapshotBtn');
            if (snapshotBtn) {
                snapshotBtn.disabled = false;
            }

            startDetection();
        };

    } catch (error) {
        let message;
        let showRetry = true;

        switch (error.name) {
            case 'NotAllowedError':
            case 'PermissionDeniedError':
            case 'SecurityError':
                message = 'Camera access denied. Open browser site settings and allow Camera permission, then click Retry.';
                break;
            case 'NotFoundError':
            case 'DevicesNotFoundError':
                message = 'No camera found. Connect a camera and try again.';
                showRetry = false;
                break;
            case 'NotReadableError':
            case 'TrackStartError':
                message = 'Camera is already in use by another application. Close other camera apps and retry.';
                break;
            case 'OverconstrainedError':
            case 'ConstraintNotSatisfiedError':
                message = 'Camera constraints cannot be satisfied. Try a different browser or device.';
                break;
            default:
                message = `Camera initialization failed: ${error.message}`;
        }

        showCameraMessage(message, true);
        showRetryButton(showRetry);

        console.error('Camera initialization error:', error);
    }
}

async function retryCamera() {
    showCameraMessage('Retrying camera access...', false);
    showRetryButton(false);
    await awaitStartCamera();
}

async function awaitStartCamera() {
    // Re-run camera initialization safely
    if (detectionInterval) {
        clearInterval(detectionInterval);
        detectionInterval = null;
    }
    if (video && video.srcObject) {
        const stream = video.srcObject;
        if (stream.getTracks) {
            stream.getTracks().forEach(track => track.stop());
        }
        video.srcObject = null;
    }
    return startCamera();
}

async function checkCameraPermission() {
    if (!navigator.permissions || !navigator.permissions.query) {
        return;
    }

    try {
        const status = await navigator.permissions.query({ name: 'camera' });
        updatePermissionState(status.state);
        status.onchange = () => updatePermissionState(status.state);
    } catch (error) {
        console.warn('Permissions API camera query failed:', error);
    }
}

function updatePermissionState(state) {
    if (state === 'denied') {
        showCameraMessage('Camera permission is denied. Open browser site settings and allow camera access, then retry.', true);
        showRetryButton(true);
    } else if (state === 'prompt') {
        showCameraMessage('Camera permission is required. Click Retry and allow camera access when prompted.', false);
        showRetryButton(true);
    } else if (state === 'granted') {
        showCameraMessage('Camera permission granted. Initializing camera...', false);
        showRetryButton(false);
    }
}

function showCameraMessage(text, isError = false) {
    const message = document.getElementById('cameraMessage');
    if (!message) return;
    message.textContent = text;
    message.style.color = isError ? '#ff5c5c' : '#00ff88';
}

function showRetryButton(show) {
    const retry = document.getElementById('retryCameraBtn');
    if (!retry) return;
    retry.style.display = show ? 'inline-block' : 'none';
}

function startDetection() {

    const captureCanvas =
        document.createElement("canvas");

    const captureCtx =
        captureCanvas.getContext("2d");

    captureCanvas.width =
        overlay.width;

    captureCanvas.height =
        overlay.height;

    detectionInterval = setInterval(async () => {
        if (isFacePauseActive) {
            return;
        }

        try {

            captureCtx.drawImage(
                video,
                0,
                0,
                captureCanvas.width,
                captureCanvas.height
            );

            const blob =
                await new Promise(resolve =>
                    captureCanvas.toBlob(
                        resolve,
                        "image/jpeg",
                        0.8
                    )
                );

            const formData =
                new FormData();

            formData.append(
                "image",
                blob,
                "frame.jpg"
            );

            const response =
                await fetch(
                    "/detect",
                    {
                        method: "POST",
                        body: formData
                    }
                );

            if (!response.ok) {
                throw new Error(
                    "Backend Error"
                );
            }

            const data =
                await response.json();

            updateDashboard(data);

            if (data.count > 0 && !isFacePauseActive) {
                playDetectionSound();
                pauseForFaceDetection();
            }

        } catch (err) {

            console.error(err);

            addLog(
                "Backend connection failed"
            );
        }

    }, 300);
}

function playDetectionSound() {
    if (!detectionSound) {
        return;
    }

    try {
        detectionSound.currentTime = 0;
        detectionSound.play();
        setTimeout(() => {
            try {
                detectionSound.pause();
            } catch (err) {
                console.warn('Sound stop failed:', err);
            }
        }, 500);
    } catch (err) {
        console.warn('Sound playback failed:', err);
    }
}

function pauseForFaceDetection() {
    isFacePauseActive = true;
    addLog('Face detected - pausing video for 2 seconds');

    if (video && !video.paused) {
        video.pause();
    }

    if (facePauseTimeout) {
        clearTimeout(facePauseTimeout);
    }
    facePauseTimeout = setTimeout(async () => {
        isFacePauseActive = false;
        addLog('Resuming video detection');
        if (video && video.paused) {
            try {
                await video.play();
            } catch (err) {
                console.warn('Unable to resume video playback:', err);
            }
        }
    }, 2000);
}

function updateDashboard(data) {

    updateFPS();

    document.getElementById(
        "faceCount"
    ).innerText = data.count;

    overlayCtx.clearRect(
        0,
        0,
        overlay.width,
        overlay.height
    );

    let cards = "";

    data.faces.forEach((face, index) => {

        drawFaceBox(face);

        cards += `
        <div class="face-card">

            <h3>Face ${index + 1}</h3>

            <p><b>X:</b> ${face.x}</p>

            <p><b>Y:</b> ${face.y}</p>

            <p><b>Width:</b> ${face.width}</p>

            <p><b>Height:</b> ${face.height}</p>

            <p><b>Center X:</b> ${face.center_x}</p>

            <p><b>Center Y:</b> ${face.center_y}</p>

            <p><b>Area:</b> ${face.area}</p>

        </div>
        `;
    });

    document.getElementById(
        "faceInfo"
    ).innerHTML = cards;

    if (data.count > 0) {

        addLog(
            `${data.count} face(s) detected`
        );
    }
}

function drawFaceBox(face) {

    overlayCtx.strokeStyle =
        "#00ff88";

    overlayCtx.lineWidth = 3;

    overlayCtx.strokeRect(
        face.x,
        face.y,
        face.width,
        face.height
    );

    overlayCtx.fillStyle =
        "#00ff88";

    overlayCtx.font =
        "16px Orbitron";

    overlayCtx.fillText(
        `X:${face.x} Y:${face.y}`,
        face.x,
        face.y - 25
    );

    overlayCtx.fillText(
        `W:${face.width} H:${face.height}`,
        face.x,
        face.y - 5
    );

    overlayCtx.beginPath();

    overlayCtx.arc(
        face.center_x,
        face.center_y,
        4,
        0,
        Math.PI * 2
    );

    overlayCtx.fill();
}

function updateFPS() {

    const now =
        performance.now();

    const fps =
        Math.round(
            1000 /
            (now - lastFrameTime)
        );

    lastFrameTime = now;

    document.getElementById(
        "fps"
    ).innerText = fps;
}

function addLog(message) {

    const container =
        document.getElementById(
            "logContainer"
        );

    const entry =
        document.createElement("div");

    entry.className = "log";

    entry.innerHTML =
        `[${new Date().toLocaleTimeString()}] ${message}`;

    container.prepend(entry);

    if (container.children.length > 30) {

        container.removeChild(
            container.lastChild
        );
    }
}

function captureSnapshot() {
    // Ensure camera is initialized and video dimensions are available
    if (!video || !video.videoWidth || !video.videoHeight) {
        addLog("Snapshot failed: camera not ready");
        alert("Camera not ready. Please allow camera access and wait a moment.");
        return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    canvas.getContext("2d").drawImage(video, 0, 0);

    const link = document.createElement("a");
    link.download = `face_${Date.now()}.png`;
    link.href = canvas.toDataURL();
    link.click();

    addLog("Snapshot Captured");
}

window.onload = () => {
    // Initialize particle background if the library is present
    if (typeof particlesJS === "function") {
        particlesJS(
            "particles-js",
            {
                particles: {
                    number: { value: 80 },
                    size: { value: 3 },
                    move: { speed: 2 },
                    line_linked: { enable: true }
                }
            }
        );
    } else {
        console.warn("particlesJS not available — skipping particle background.");
    }

    const retryBtn = document.getElementById('retryCameraBtn');
    if (retryBtn) {
        retryBtn.addEventListener('click', retryCamera);
    }

    detectionSound = new Audio('/sound/beep');
    detectionSound.preload = 'auto';
    detectionSound.volume = 0.8;

    checkCameraPermission();
    startCamera();
};
