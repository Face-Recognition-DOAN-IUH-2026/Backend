from __future__ import annotations

import json
from celery.result import AsyncResult
from fastapi import APIRouter, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from worker.celery_app import celery_app

router = APIRouter(prefix="/tasks", tags=["tasks"])


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str
    result: dict | None = None


def _get_task_result_sync(task_id: str) -> dict:
    task_result = AsyncResult(task_id, app=celery_app)
    task_status = "PENDING"
    response_result = None

    try:
        task_status = task_result.status
        if task_status == "SUCCESS":
            try:
                raw = task_result.result
                if raw is None:
                    response_result = None
                elif isinstance(raw, dict):
                    response_result = raw
                elif isinstance(raw, str):
                    try:
                        response_result = json.loads(raw)
                    except:
                        response_result = {"message": raw}
                else:
                    response_result = {"result": str(raw)}
            except Exception as e:
                response_result = {"error": str(e), "type": "result_error"}
        elif task_status == "FAILURE":
            try:
                error_info = str(task_result.result)
                response_result = {"error": error_info, "type": "task_failure"}
            except Exception:
                response_result = {"error": "Task failed", "type": "task_failure"}
    except Exception as e:
        task_status = "PENDING"
        response_result = None

    return {
        "task_id": task_id,
        "status": task_status,
        "result": response_result,
    }


@router.get("/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str):
    try:
        result = await run_in_threadpool(_get_task_result_sync, task_id)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid task ID: {str(e)}"
        )
    return TaskStatusResponse(**result)
