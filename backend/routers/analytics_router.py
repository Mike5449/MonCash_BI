import os
import traceback
import pandas as pd
from fastapi import APIRouter, Depends, Query, Request, File, UploadFile, Form
from fastapi import HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import List, Optional, Any
from database import get_db
from services.excel_analytics_service import ExcelAnalyticsService
from core.config import settings

router = APIRouter(
    prefix="/analytics",
    tags=["analytics"]
)

@router.post("/upload-bulk", summary="Extract MSISDNs or SHORTCODEs from uploaded file")
async def upload_bulk_file(file: UploadFile = File(...)):
    try:
        content = await file.read()
        result = ExcelAnalyticsService.extract_identifiers_from_file(content, file.filename)
        kind = result["kind"]
        values = result["values"]
        # Rétro-compatible : on continue à exposer "msisdns" pour les anciens callers,
        # tout en exposant "shortcodes" et "kind" pour les nouveaux.
        return {
            "filename": file.filename,
            "count": len(values),
            "kind": kind,                                    # 'msisdn' | 'shortcode' | 'name'
            "column": result.get("column"),
            "msisdns":    values if kind == "msisdn"    else [],
            "shortcodes": values if kind == "shortcode" else [],
            "names":      values if kind == "name"      else [],
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        return JSONResponse(status_code=500, content={"message": f"Error parsing file: {str(e)}"})

@router.get("/ht-list-info", summary="Get info and preview of the input file")
def get_ht_list_info():
    try:
        path = settings.ANALYTICS_INPUT_PATH.strip('"').strip("'")
        if not os.path.exists(path):
            return {"status": "error", "message": f"File not found at: {path}"}
        if path.lower().endswith('.csv'):
            df = pd.read_csv(path, sep=None, engine='python', dtype=str).head(5)
        else:
            df = pd.read_excel(path, dtype=str).head(5)
        df_clean = df.fillna('')
        return {
            "status": "success",
            "path": path,
            "columns": df_clean.columns.tolist(),
            "preview": df_clean.to_dict('records')
        }
    except Exception as e:
        return {"status": "error", "message": f"System error reading file: {str(e)}"}

@router.post("/process-ht-list", summary="Process the default Excel list and enrich it")
def process_ht_list(db: Session = Depends(get_db)):
    try:
        return ExcelAnalyticsService.process_ht_list(db, settings.ANALYTICS_INPUT_PATH)
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": f"Error during processing: {str(e)}", "traceback": traceback.format_exc()})


@router.post("/process-uploaded-list", summary="Upload an Excel/CSV file, enrich in-memory and return enriched rows")
async def process_uploaded_list(
    file: UploadFile = File(...),
    identify_column: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """
    Upload un fichier (.xlsx, .xlsm, .csv), détecte automatiquement la colonne MSISDN
    et la colonne NOM (optionnelle), enrichit chaque MSISDN via Databricks et retourne
    les données enrichies en JSON. Aucun fichier n'est écrit sur disque.

    - `identify_column` (optionnel) : nom EXACT de la colonne du fichier à utiliser comme IDENTIFY.
      Si fourni, court-circuite l'auto-détection.
    """
    try:
        content = await file.read()
        return ExcelAnalyticsService.process_uploaded_list(
            db, content, file.filename or "uploaded.xlsx",
            identify_column=identify_column,
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": f"Error during processing: {str(e)}", "traceback": traceback.format_exc()})
