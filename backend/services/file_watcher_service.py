import os
import time
import logging
import threading
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from core.config import settings
from database import SessionLocal
from services.excel_analytics_service import ExcelAnalyticsService

logger = logging.getLogger(__name__)

class ExcelFileHandler(FileSystemEventHandler):
    def __init__(self, file_path, callback_func):
        self.file_path = os.path.abspath(file_path)
        self.callback_func = callback_func
        self.last_triggered = 0.0
        self.lock = threading.Lock()
        # Cooldown in seconds to prevent infinite loops (since we modify the file we watch)
        self.cooldown = 10 

    def on_modified(self, event):
        if event.is_directory:
            return
        
        event_path = os.path.abspath(event.src_path)
        if event_path == self.file_path:
            current_time = time.time()
            
            # Check cooldown and lock
            if (current_time - self.last_triggered) < self.cooldown:
                return

            if self.lock.locked():
                return

            with self.lock:
                logger.info(f"Auto-trigger: File modification detected on {self.file_path}")
                self.last_triggered = time.time()
                
                # We need a fresh DB session for the background task
                db = SessionLocal()
                try:
                    # Small delay to let Excel finish saving/releasing the lock
                    time.sleep(1)
                    result = self.callback_func(db, self.file_path)
                    if result.get("status") == "success":
                        logger.info(f"Auto-enrichment successful: {result.get('records_found')} records found.")
                    else:
                        logger.warning(f"Auto-enrichment failed/skipped: {result.get('message', 'Unknown error')}")
                except Exception as e:
                    logger.error(f"Error during auto-enrichment: {str(e)}")
                finally:
                    db.close()
                    # Update last_triggered again after work is done to maintain cooldown
                    self.last_triggered = time.time()

class FileWatcherService:
    def __init__(self):
        self.observer = None
        self.stop_event = threading.Event()

    def start(self):
        file_to_watch = settings.ANALYTICS_INPUT_PATH
        if not file_to_watch or not os.path.exists(file_to_watch):
            logger.warning(f"File watcher NOT started: Path '{file_to_watch}' does not exist or is not set.")
            return

        directory = os.path.dirname(os.path.abspath(file_to_watch))
        handler = ExcelFileHandler(file_to_watch, ExcelAnalyticsService.process_ht_list)
        
        self.observer = Observer()
        self.observer.schedule(handler, directory, recursive=False)
        self.observer.start()
        logger.info(f"File watcher started on: {file_to_watch}")

    def stop(self):
        self.stop_event.set()
        if self.observer:
            self.observer.stop()
            # Set a timeout so we don't hang uvicorn reload indefinitely
            self.observer.join(timeout=2)
            logger.info("File watcher stopped.")

# Singleton instance
watcher_service = FileWatcherService()
