# RenewableX User Guide

This guide is for project owners, engineers, and non-technical users who want to design, simulate, compare, and export reports for hybrid energy systems (PV, BESS, biomass, diesel generator, and EMS), or run a quick PV feasibility screen. An Indonesian version is in [user-guide-id.md](user-guide-id.md).

---

## 1. Two workspaces: quick PV screening and hybrid design

Pick a workspace from the top navigation.

1. **Quick PV screening (`/`)**
   - For a first feasibility estimate of a PV plant without batteries and without an hourly load profile.
   - Uses an annual yield and returns NPV, IRR, simple payback, and a basic sensitivity table.
2. **Hybrid system design (`/hybrid`)**
   - A full hourly simulation (8,760 hours per year, project life up to 40 years) for systems combining solar PV (detailed 8-stage model or PVWatts), BESS with calendar and cycle degradation, biomass generation, an optional diesel generator (non-renewable), and an EMS strategy that decides how the system operates.
   - Projects are saved in your browser (`localStorage`). Export a `.hybrid.json` backup regularly from step 1 (`/hybrid`) or step 10.

> **Free server cold start:** the calculation engine runs on Render's free plan. After about 15 minutes without requests it goes to sleep, and the first request afterwards can take 30 to 60 seconds. Keep the page open while the loading indicator says the server is waking up. The request continues on its own once the engine is ready.

---

## 2. Step by step, pages 1 to 10

1. **Project (`/hybrid`)**
   - Click **Load Sample [REAL DATA]** to try a complete configuration (500 kWp PV, 600 kWh BESS, 250 kW biomass in Cikarang), or **Create New Project** to start from scratch.
   - You can also duplicate a project, import a `.hybrid.json` file, or click **Open Guide** (`/hybrid/guide`).
2. **Location and weather (`/hybrid/[projectId]/location`)**
   - Enter the project name, latitude and longitude (or pick an Indonesian city preset), and the local time zone (`WIB`, `WITA`, `WIT`, or `UTC`).
   - Click **Fetch PVGIS Weather Data** to download hourly solar irradiance (GHI, DNI, DHI), air temperature, and wind speed from PVGIS v5.3 TMY (`PVGIS-ERA5`, period 2005 to 2023).
3. **Load profile (`/hybrid/[projectId]/load`)**
   - Choose **Synthetic generator** (set base load, peak load, noise, and a seed so the result repeats exactly) or **Upload 8,760-hour CSV**.
   - Click **Preview & Validate Load** to check the 24-hour daily curve and the 365 x 24 annual heat map.
4. **System design and schematic canvas (`/hybrid/[projectId]/system`)**
   - Arrange components on the interactive canvas: add optional components (BESS, biomass, diesel generator, grid), move blocks, and connect or disconnect them from the AC bus.
   - Click a component to edit its parameters in the inspector panel on the right (below the canvas on a 360 px phone screen).
   - Required components (AC bus, solar PV, and electrical load) are locked. If one of their connections is removed, the app shows a validation error before you can simulate.
5. **EMS strategy (`/hybrid/[projectId]/ems`)**
   - Pick one of the five built-in strategies: self-consumption, load following, cycle charging, peak shaving, or time-of-use arbitrage. Or pick the custom EMS option and edit its rule set (stored as JSON).
   - Set whether the system may import from and export to the grid, plus strategy settings such as a target SOC or a peak load limit.
   - Custom rules use the draft rule format until the owner's final EMS schema is confirmed.
6. **Economics, costs, and tariffs (`/hybrid/[projectId]/economics`)**
   - Choose the currency (IDR or USD), project life (1 to 40 years), tax model (`Pre-Tax` or `After-Tax`), discount rate (WACC), escalation for tariff, O&M, and fuel, CAPEX per component, and the electricity tariff.
7. **Review and run (`/hybrid/[projectId]/run`)**
   - Check the configuration summary and make sure the topology is valid.
   - Choose a multi-year mode:
     - **`scaled_year_1` (default, fast):** simulates year 1 hour by hour, then scales PV degradation and the replacement schedule to years 2 to N.
     - **`full_hourly` (async job, most detailed):** simulates 8,760 hours for every year of the project life in sequence, including hourly battery ageing, as a background job.
   - Click **Run Simulation**.
8. **Results dashboard (`/hybrid/[projectId]/results`)**
   - **Summary and monthly tab:** stacked monthly energy chart, PV loss diagram (waterfall), energy flow diagram (Sankey, year 1), year 1 flow schematic (downloadable as SVG), and technical summary cards.
   - **Dispatch and SOC tab:** hourly power flow (move the start day and choose a 24-hour, 3-day, or 7-day window), battery SOC curve, the EMS decision reason for each hour, and load and generation duration curves.
   - **8,760-hour heat map tab:** 365 days x 24 hours for load, PV production, BESS SOC, and unmet load.
   - **Finance and cash flow tab:** annual and cumulative cash flow, LCOE breakdown, PV and BESS capacity degradation over the project life, a year 0 to N cash flow table, and quick JSON and CSV export.
9. **Compare (`/hybrid/[projectId]/compare`)**
   - **Size sweep:** test up to 64 combinations of PV, BESS, and biomass sizes at once, view the Pareto curve, then apply a combination to the project or save it as a scenario.
   - **Compare projects:** place up to 4 simulated projects side by side.
   - **Hybrid sensitivity:** a tornado chart (the effect of one variable on NPV or LCOE) and a 5 x 5 matrix (click any cell to read the exact values).
10. **Export reports (`/hybrid/[projectId]/export`)**
    - Print or save an A4 PDF report with the flow schematic in a light print theme.
    - Download a multi-sheet Excel workbook (`.xlsx`) with `Ringkasan` (summary), `Energi_Bulanan` (monthly energy), `Arus_Kas_Tahunan` (annual cash flow), `Asumsi_Konfigurasi` (configuration assumptions), and optionally `Hasil_Sapuan` (sweep results) and `Sensitivitas` (sensitivity).
    - Download raw data: 8,760-hour CSV, cash flow CSV, sweep results CSV, and a JSON bundle.

---

## 3. Load CSV format and common errors

A ready-to-upload sample file is in `examples/sample-load-8760.csv`.

### File rules

- **Rows:** exactly 8,760 hourly values (policy `ignore_feb_29`: 365 days x 24 hours, no 29 February).
- **Accepted columns:**
  1. one column with the load in kW, or
  2. two columns with time first and load in kW second (`waktu,load_kw`), for example:
     ```csv
     waktu,load_kw
     01-01 00:00,142.844
     01-01 01:00,129.023
     01-01 02:00,138.821
     01-01 03:00,142.501
     ```
- **Separator:** comma (`,`) or semicolon (`;`). A text header in the first row is detected and skipped when its value column is not a number.
- **Values:** no empty cells, invalid text, `NaN`, or negative values (`< 0`).

### Common CSV errors

- `invalid_load_length`: the number of values is not 8,760. Look for empty rows at the end of the file, or leap-year data (8,784 rows) that still contains 29 February.
- `negative_load_value`: a load value is below zero. All load values must be `>= 0`. Export or surplus is not written as negative load.
- `invalid_csv_format` / `non_finite_load_value`: the load column contains non-numeric characters or inconsistent number separators.

---

## 4. Technical and financial metrics

| Term | Meaning |
|---|---|
| **LCOE** (levelized cost of energy) | Average cost per kWh produced over the project life, including CAPEX, O&M, fuel, and replacements, minus salvage value and export credits. Lower is cheaper. |
| **Total NPC** (net present cost) | All project costs from year 0 to the end of the project life in today's money (discounted at WACC), minus salvage and export revenue. |
| **NPV** (net present value) | Present value of all electricity savings or revenue minus all project costs. NPV > 0 means the project adds value above the discount rate (WACC). |
| **IRR** (internal rate of return) | The project's effective annual return. A project is marked **Viable** when `NPV > 0` and `IRR >= WACC + viability margin` (default margin `2%`). |
| **Simple and discounted payback** | The year in which the initial investment is recovered. Discounted payback accounts for the time value of money (WACC), so it is longer than simple payback. |
| **Renewable fraction** | Share of the load supplied by renewable sources (PV and renewable biomass). Grid imports and the diesel generator count as non-renewable. |
| **Unmet load** | Load energy (kWh or MWh) the system could not supply because generation and battery capacity were not enough in some hours. |
| **Curtailment** | Surplus production (usually midday PV) that had to be discarded because the battery was full and grid export was not allowed or was limited. |
| **EFC** (equivalent full cycles) | Number of full battery cycles, counted as 100% discharges of the effective capacity. Used to track battery wear. |
| **Avoided CO2e emissions** | Difference between the emissions if all load were bought from the baseline grid (`0.78 kg CO2e/kWh` `[REAL DATA]`) and the emissions of the hybrid system in operation. |

---

## 5. Reading the sweep, Pareto curve, tornado, and 5 x 5 matrix

1. **Size sweep (tab 1 of page 9)**
   - Enter candidate sizes for PV (kWp), BESS (kWh), biomass (kW), and optionally the diesel generator (kW). Enter `0` for BESS, biomass, or diesel to compare configurations without that component.
   - The engine evaluates every combination (up to `64` in `scaled_year_1` mode, `12` in `full_hourly`) and ranks them. Combinations that fail the **Max. unmet load** or **Min. renewable** limit stay in the list, at the bottom, with the reason they failed.
   - The **Pareto curve** plots renewable fraction (x axis) against LCOE (y axis). The best points usually sit at the bottom right: high renewable fraction with the lowest LCOE.
2. **Tornado and 5 x 5 matrix (tab 3 of page 9)**
   - The **tornado chart** sorts assumptions by how much they move NPV or LCOE, with the longest bar at the top.
   - The **5 x 5 matrix** changes two assumptions together (for example total CAPEX and electricity tariff). Click any cell (or press `Tab` then `Enter`) to read NPV, LCOE, IRR, and viability status for that cell.

---

## 6. `[REAL DATA]` labels and replacing defaults with datasheet values

Every default number in the sample project labelled `[REAL DATA]` comes from [assumptions.md](assumptions.md), for example PV CAPEX `Rp 11,500,000/kWp`, BESS CAPEX `Rp 3,500,000/kWh`, reference tariff `Rp 1,445/kWh`, grid emission factor `0.78 kg CO2e/kWh`, and 5 biomass fuel presets.

Before using results for an investment decision or a commercial offer, replace these parameters with values from official datasheets or quotations:

1. **PV modules and inverter (page 4):** capacity, DC/AC ratio, temperature coefficient, inverter efficiency curve, and actual cable and shading losses at the site.
2. **BESS (page 4):** capacity, manufacturer's safe SOC limits, round-trip efficiency, and warranted degradation rate.
3. **Biomass and diesel generator (page 4):** fuel consumption curve (heat rate or litres per kWh), local fuel purchase and logistics prices, overhaul interval, and periodic supply limits.
4. **Economics and tariffs (page 6):** EPC CAPEX quotations per component (including diesel when active), O&M contract costs, discount rate (WACC), and the applicable PLN or PPA tariff structure.
