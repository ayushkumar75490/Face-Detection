from flask import Flask, request, jsonify, render_template, send_from_directory
from flask_cors import CORS
import cv2
import numpy as np

app = Flask(__name__)
CORS(app)

face_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades +
    "haarcascade_frontalface_default.xml"
)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/detect", methods=["POST"])
def detect():

    if "image" not in request.files:
        return jsonify({"error": "No image received"}), 400

    file = request.files["image"]

    image_bytes = file.read()

    np_array = np.frombuffer(
        image_bytes,
        np.uint8
    )

    image = cv2.imdecode(
        np_array,
        cv2.IMREAD_COLOR
    )

    if image is None:
        return jsonify({"error": "Invalid image"}), 400

    # Resize the image for faster detection while keeping enough detail
    max_size = 640
    height, width = image.shape[:2]
    if max(height, width) > max_size:
        scale = max_size / float(max(height, width))
        image = cv2.resize(
            image,
            (int(width * scale), int(height * scale)),
            interpolation=cv2.INTER_LINEAR
        )

    gray = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2GRAY
    )

    # Improve detection for all regions of the frame
    gray = cv2.equalizeHist(gray)

    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(64, 64),
        flags=cv2.CASCADE_SCALE_IMAGE
    )

    results = []

    for (x, y, w, h) in faces:
        aspect_ratio = w / float(h)
        area = w * h

        # Filter out non-face shapes and very small candidates
        if area < 2500:
            continue
        if aspect_ratio < 0.7 or aspect_ratio > 1.4:
            continue

        cv2.rectangle(
            image,
            (x, y),
            (x + w, y + h),
            (0, 0, 255),  # Red color
            2             # Thickness
        )

        results.append({
            "x": int(x),
            "y": int(y),
            "width": int(w),
            "height": int(h),
            "center_x": int(x + w),
            "center_y": int(y + h),
            "area": int(area)
        })

    return jsonify({
        "count": len(results),
        "faces": results
    })


@app.route('/sound/beep')
def sound_beep():
    return send_from_directory(
        app.root_path,
        'Beep.mp3',
        mimetype='audio/mpeg'
    )


if __name__ == "__main__":
    app.run(
        debug=True
    )