import pytest
from core.parser import parse_fire_boxes, calculate_iou


def test_parse_fire_boxes_single():
    raw_output = "fire <box><100><200><300><400></box>"
    boxes = parse_fire_boxes(raw_output, img_width=1000, img_height=1000)
    assert len(boxes) == 1
    assert boxes[0]["label"] == "fire"
    assert boxes[0]["box"] == [100, 200, 300, 400]
    assert boxes[0]["width"] == 200
    assert boxes[0]["height"] == 200


def test_parse_fire_boxes_multiple_with_smoke():
    raw_output = "fire <box><150><250><450><650></box> thick smoke <box><500><100><800><300></box>"
    boxes = parse_fire_boxes(raw_output, img_width=1920, img_height=1080)
    assert len(boxes) == 2
    assert boxes[0]["label"] == "fire"
    assert boxes[1]["label"] == "smoke"
    # Check pixel scaling (1920 x 1080)
    assert boxes[0]["box"][0] == int(150 / 1000 * 1920)
    assert boxes[1]["box"][1] == int(100 / 1000 * 1080)


def test_parse_fire_boxes_inverted_coordinates():
    # If model outputs x2 < x1 or y2 < y1, parser should normalize order
    raw_output = "<box><400><500><200><100></box>"
    boxes = parse_fire_boxes(raw_output, img_width=1000, img_height=1000)
    assert len(boxes) == 1
    assert boxes[0]["box"] == [200, 100, 400, 500]


def test_calculate_iou():
    boxA = [100, 100, 200, 200]
    boxB = [100, 100, 200, 200]
    assert calculate_iou(boxA, boxB) == 1.0

    boxC = [300, 300, 400, 400]
    assert calculate_iou(boxA, boxC) == 0.0

    # Half overlap
    boxD = [150, 100, 250, 200]
    iou = calculate_iou(boxA, boxD)
    assert 0.3 < iou < 0.4
