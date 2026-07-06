# SUMO Integration Plan

## Overview

Replace the JavaScript microsimulation with SUMO (Simulation of Urban MObility) to achieve scientifically valid traffic physics while preserving the existing 2D canvas visualization and car models.

**Goal:** Run SUMO headless, broadcast vehicle positions via WebSocket, render in the existing canvas with current car models.

---

## Prerequisites

### 1. Install SUMO

```bash
# macOS
brew install sumo

# Or via pip (cross-platform)
pip install eclipse-sumo traci sumolib

# Verify installation
sumo --version
```

Set `SUMO_HOME` environment variable:
```bash
# Add to ~/.zshrc or ~/.bashrc
export SUMO_HOME=/opt/homebrew/opt/sumo/share/sumo
# Or for pip installation:
export SUMO_HOME=$(python -c "import sumo; print(sumo.SUMO_HOME)")
```

### 2. Python Environment

Create a Python virtual environment for the backend:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn traci sumolib pyproj websockets
```

---

## Implementation Phases

### Phase 1: SUMO Network Generation

**Objective:** Convert City Walk OSM data to SUMO network format.

**Files to create:**
- `sim/01_download_osm.py` - Download OSM data for SUMO
- `sim/02_build_network.sh` - Run netconvert and polyconvert
- `sim/03_generate_traffic.sh` - Generate random demand
- `sim/net/citywalk.net.xml` - Generated SUMO network
- `sim/routes/citywalk.rou.xml` - Generated vehicle routes
- `sim/citywalk.sumocfg` - SUMO configuration

**Steps:**

1. **Download OSM for SUMO** (`sim/01_download_osm.py`)
   - Use Overpass API to download City Walk bounding box
   - BBOX: `25.198,55.252,25.216,55.273` (from existing `build-osm-data.mjs`)
   - Save as `sim/data/osm/roads.osm.xml` and `sim/data/osm/polygons.osm.xml`

2. **Build SUMO network** (`sim/02_build_network.sh`)
   ```bash
   #!/bin/bash
   netconvert \
       --osm-files data/osm/roads.osm.xml \
       --output-file net/citywalk.net.xml \
       --type-files "$SUMO_HOME/data/typemap/osmNetconvert.typ.xml" \
       --geometry.remove \
       --ramps.guess \
       --junctions.join \
       --roundabouts.guess \
       --remove-edges.isolated \
       --keep-edges.by-vclass passenger,bus,truck,delivery \
       --tls.guess-signals \
       --tls.discard-simple \
       --tls.join \
       --tls.default-type static \
       --osm.layer-elevation 6 \
       --output.street-names \
       --output.original-names
   
   polyconvert \
       --net-file net/citywalk.net.xml \
       --osm-files data/osm/polygons.osm.xml \
       --type-file "$SUMO_HOME/data/typemap/osmPolyconvert.typ.xml" \
       --output-file net/citywalk.poly.xml
   ```

3. **Generate random traffic** (`sim/03_generate_traffic.sh`)
   ```bash
   #!/bin/bash
   python "$SUMO_HOME/tools/randomTrips.py" \
       --net-file net/citywalk.net.xml \
       --output-trip-file routes/citywalk.trips.xml \
       --route-file routes/citywalk.rou.xml \
       --begin 0 --end 3600 --period 0.75 \
       --fringe-factor 10 \
       --min-distance 600 \
       --vehicle-class passenger \
       --prefix veh \
       --validate
   ```

4. **Create SUMO config** (`sim/citywalk.sumocfg`)
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <configuration>
       <input>
           <net-file value="net/citywalk.net.xml"/>
           <route-files value="routes/citywalk.rou.xml"/>
       </input>
       <time>
           <begin value="0"/>
           <end value="3600"/>
           <step-length value="0.4"/>
       </time>
       <processing>
           <ignore-junction-blocker value="60"/>
           <time-to-teleport value="300"/>
       </processing>
       <report>
           <no-step-log value="true"/>
           <duration-log.statistics value="false"/>
       </report>
   </configuration>
   ```

**Verification:**
```bash
cd sim
sumo-gui -c citywalk.sumocfg
```
Should open SUMO GUI and show vehicles driving around City Walk network.

---

### Phase 2: FastAPI/TraCI Bridge

**Objective:** Run SUMO headless and broadcast vehicle positions via WebSocket.

**Files to create:**
- `backend/server.py` - FastAPI server with TraCI bridge
- `backend/requirements.txt` - Python dependencies
- `backend/run.sh` - Startup script

**Implementation:**

1. **Create backend directory structure:**
   ```
   backend/
   ├── server.py
   ├── requirements.txt
   └── run.sh
   ```

2. **Install dependencies** (`backend/requirements.txt`):
   ```
   fastapi
   uvicorn[standard]
   traci
   sumolib
   pyproj
   websockets
   ```

3. **Implement FastAPI bridge** (`backend/server.py`):
   
   **Key components:**
   - SUMO startup with TraCI connection
   - Vehicle subscription for position/angle/speed
   - Coordinate conversion (SUMO XY → lon/lat)
   - WebSocket broadcasting at 0.4s intervals
   - Soft real-time pacing
   
   **Message format:**
   ```json
   {
     "t": 123.4,
     "n": 450,
     "veh": [
       ["veh_0", 55.265, 25.207, 0.0, 45.2, 12.5],
       ["veh_1", 55.266, 25.208, 0.0, 90.1, 8.3]
     ]
   }
   ```
   Where each vehicle is: `[id, lon, lat, z, angle_deg, speed_ms]`

4. **Startup script** (`backend/run.sh`):
   ```bash
   #!/bin/bash
   cd "$(dirname "$0")"
   source ../.venv/bin/activate
   uvicorn server:app --host 127.0.0.1 --port 8000
   ```

**Verification:**
```bash
# Terminal 1: Start backend
cd backend
./run.sh

# Terminal 2: Test WebSocket
python backend/test_ws.py  # (create simple test client)
```

---

### Phase 3: Frontend WebSocket Integration

**Objective:** Connect existing canvas to SUMO backend, render real vehicle positions.

**Files to modify:**
- `app/components/CityWalkDashboard.tsx` - Add WebSocket client, remove JS simulation

**Changes:**

1. **Add WebSocket connection:**
   ```typescript
   useEffect(() => {
     const ws = new WebSocket('ws://localhost:8000/ws');
     
     ws.onmessage = (event) => {
       const data = JSON.parse(event.data);
       setSumoVehicles(data.veh); // [id, lon, lat, z, angle, speed][]
       setSimTime(data.t);
     };
     
     ws.onclose = () => {
       setTimeout(() => reconnect(), 3000);
     };
     
     return () => ws.close();
   }, []);
   ```

2. **Add state for SUMO vehicles:**
   ```typescript
   const [sumoVehicles, setSumoVehicles] = useState<Array<[string, number, number, number, number, number]>>([]);
   const [simTime, setSimTime] = useState(0);
   const [connected, setConnected] = useState(false);
   ```

3. **Remove JS vehicle simulation:**
   - Delete `createVehicles()` function
   - Delete `buildVehicleRoutes()` function
   - Delete vehicle movement loop in `draw()` (lines 1122-1143)
   - Keep `drawVehicle()` - render SUMO vehicles with existing car models

4. **Render SUMO vehicles:**
   ```typescript
   // In draw() function, replace JS vehicle loop with:
   for (const [id, lon, lat, z, angle, speed] of sumoVehicles) {
     const point = worldFromLatLon({ lat, lon });
     const screen = screenFromWorld(point, currentView);
     
     if (screen.x < -20 || screen.y < -20 || screen.x > size.width + 20 || screen.y > size.height + 20) continue;
     
     // Convert SUMO angle (deg, clockwise from north) to canvas angle (rad)
     const canvasAngle = (angle * Math.PI / 180) - Math.PI / 2;
     
     drawVehicle(ctx, screen.x, screen.y, canvasAngle, '#2EC4A0', currentView.scale);
   }
   ```

5. **Add connection status indicator:**
   ```typescript
   <div className="connectionStatus">
     <span className={connected ? 'connected' : 'disconnected'} />
     {connected ? 'SUMO Connected' : 'Disconnected'}
   </div>
   ```

**Keep from existing code:**
- Road rendering (`drawStaticMap()`)
- Signal rendering and logic
- Polygon rendering (buildings, water)
- Dashboard UI (metrics, filters, search)
- Pan/zoom/interaction handlers
- TomTom API integration (optional overlay)

**Remove or disable:**
- `createVehicles()` - SUMO provides vehicles
- `buildVehicleRoutes()` - SUMO does routing
- Vehicle physics loop - SUMO handles it
- `vehicleTarget` constant - not needed

---

### Phase 4: Signal Control Integration (Optional)

**Objective:** Allow frontend to control SUMO traffic lights.

**Files to modify:**
- `backend/server.py` - Add `/signal` endpoint
- `app/components/CityWalkDashboard.tsx` - Add signal control UI

**Implementation:**

1. **Backend endpoint:**
   ```python
   @app.post("/signal")
   async def set_signal(req: SignalRequest) -> dict:
       with TRACI_LOCK:
           traci.trafficlight.setRedYellowGreenState(req.tls_id, req.state)
       return {"status": "ok"}
   ```

2. **Frontend integration:**
   - Map existing `phaseForSignal()` logic to SUMO TLS IDs
   - Send signal state changes to backend
   - Sync SUMO signal state with canvas rendering

---

## File Structure

```
citywalk-traffic-twin/
├── app/                          # Next.js frontend (existing)
│   ├── components/
│   │   └── CityWalkDashboard.tsx # Modified: WebSocket client
│   ├── data/
│   │   └── osm-citywalk.ts      # Keep: road network data
│   └── api/
│       └── traffic/route.ts     # Keep: TomTom integration
├── backend/                      # NEW: Python SUMO bridge
│   ├── server.py                # FastAPI + TraCI
│   ├── requirements.txt
│   └── run.sh
├── sim/                          # NEW: SUMO simulation files
│   ├── 01_download_osm.py
│   ├── 02_build_network.sh
│   ├── 03_generate_traffic.sh
│   ├── citywalk.sumocfg
│   ├── data/
│   │   └── osm/
│   │       ├── roads.osm.xml
│   │       └── polygons.osm.xml
│   ├── net/
│   │   ├── citywalk.net.xml     # Generated
│   │   └── citywalk.poly.xml    # Generated
│   └── routes/
│       ├── citywalk.trips.xml   # Generated
│       └── citywalk.rou.xml     # Generated
├── docs/
│   └── SUMO_INTEGRATION_PLAN.md # This file
└── .venv/                        # Python virtual environment
```

---

## Testing Strategy

### 1. Network Generation Test
```bash
cd sim
./01_download_osm.py
./02_build_network.sh
sumo-gui -c citywalk.sumocfg
```
**Expected:** SUMO GUI opens, vehicles drive around City Walk.

### 2. Backend Test
```bash
cd backend
./run.sh
```
**Expected:** Server starts on port 8000, logs show SUMO running.

### 3. WebSocket Test
```python
# test_ws.py
import asyncio
import websockets

async def test():
    async with websockets.connect('ws://localhost:8000/ws') as ws:
        msg = await ws.recv()
        data = json.loads(msg)
        print(f"Time: {data['t']}, Vehicles: {data['n']}")

asyncio.run(test())
```
**Expected:** Receives vehicle frames every 0.4s.

### 4. Frontend Integration Test
```bash
npm run dev
```
**Expected:** 
- Canvas shows City Walk roads
- Vehicles appear and move (from SUMO)
- Connection indicator shows "SUMO Connected"
- Signals still animate (local logic)

---

## Performance Considerations

1. **WebSocket message size:** With ~1000 vehicles, each frame is ~50KB. At 2.5 Hz (0.4s), this is 125KB/s - acceptable.

2. **Canvas rendering:** Existing `drawVehicle()` is efficient. Rendering 1000 vehicles at 60fps should work.

3. **SUMO step length:** 0.4s balances accuracy vs performance. Adjust via `SEHLA_STEP` env var.

4. **Coordinate conversion:** pyproj conversion is fast (~1μs per vehicle). Pre-compute if needed.

---

## Migration Checklist

- [ ] Install SUMO locally
- [ ] Create Python virtual environment
- [ ] Generate SUMO network from City Walk OSM
- [ ] Verify network in sumo-gui
- [ ] Implement FastAPI bridge
- [ ] Test WebSocket connection
- [ ] Add WebSocket client to frontend
- [ ] Remove JS vehicle simulation
- [ ] Render SUMO vehicles on canvas
- [ ] Add connection status indicator
- [ ] Test end-to-end: SUMO → WebSocket → Canvas
- [ ] (Optional) Add signal control integration
- [ ] (Optional) Add RL agent integration
- [ ] (Optional) Add Mistral agent integration

---

## Future Enhancements

1. **Real-world data:** Integrate TomTom flow data into SUMO via `phase3/02_build_demand.py` pattern
2. **RL signal control:** Port `phase4/dqn.py` for learned traffic light optimization
3. **LLM orchestration:** Port `phase5/mistral_agent.py` for natural language commands
4. **3D view:** Add CesiumJS as alternative view mode (port from SEHLA Phase 2)
5. **Scenario management:** Add scenario buttons (storm, emergency) from SEHLA Phase 5

---

## References

- SEHLA-1 source: `/Users/th/github/SEHLA-1`
- SUMO documentation: https://sumo.dlr.de/docs/
- TraCI documentation: https://sumo.dlr.de/docs/TraCI.html
- FastAPI documentation: https://fastapi.tiangolo.com/

---

**Created:** 2026-07-06  
**Status:** Draft  
**Next steps:** Begin Phase 1 (SUMO network generation)
