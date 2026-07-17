import json
from main import app

def dump_openapi():
    openapi_schema = app.openapi()
    with open("openapi.json", "w") as f:
        json.dump(openapi_schema, f, indent=2)
    print("openapi.json generated successfully.")

if __name__ == "__main__":
    dump_openapi()
