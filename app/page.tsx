'use client';

import { useState, useEffect } from "react";
import { BsTrainFront, BsArrowRepeat, BsGear } from "react-icons/bs";
import { cities } from "./cities";
import { atoc } from "./atoc";

const TrainScheduleFinder = () => {
  const [schedules, setSchedules] = useState<any[]>([]);
  const [filteredSchedules, setFilteredSchedules] = useState<any[]>([]);
  const [departureStation, setDepartureStation] = useState("Newcastle");
  const [arrivalStation, setArrivalStation] = useState("York");
  const [serviceProvider, setServiceProvider] = useState("Transpennine Express");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortType, setSortType] = useState("departure");
  const [showPastTrains, setShowPastTrains] = useState(false);

  // Settings modal
  const [modalOpen, setModalOpen] = useState(false);

  // Train details modal
  const [trainModalOpen, setTrainModalOpen] = useState(false);
  const [selectedTrain, setSelectedTrain] = useState<any | null>(null);

  // -------------------------
  // Time helpers
  // -------------------------
  const addMinutesToHHmm = (timeHHmm: string, minutesToAdd: number) => {
    if (!timeHHmm || timeHHmm === "N/A" || timeHHmm.length !== 4) return "N/A";

    const hours = parseInt(timeHHmm.slice(0, 2), 10);
    const mins = parseInt(timeHHmm.slice(2, 4), 10);
    if (Number.isNaN(hours) || Number.isNaN(mins)) return "N/A";

    const total = hours * 60 + mins + minutesToAdd;
    const wrapped = ((total % (24 * 60)) + (24 * 60)) % (24 * 60);

    const newHours = Math.floor(wrapped / 60);
    const newMins = wrapped % 60;

    return `${String(newHours).padStart(2, "0")}${String(newMins).padStart(2, "0")}`;
  };

  const toPrettyHHMM = (timeHHmm?: string) => {
    if (!timeHHmm || timeHHmm === "N/A" || timeHHmm.length !== 4) return "N/A";
    return `${timeHHmm.slice(0, 2)}:${timeHHmm.slice(2, 4)}`;
  };

  const timeToMinutes = (timeHHmm?: string) => {
    if (!timeHHmm || timeHHmm === "N/A" || timeHHmm.length !== 4) return null;
    const h = parseInt(timeHHmm.slice(0, 2), 10);
    const m = parseInt(timeHHmm.slice(2, 4), 10);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  };

  const fmtDateLine = (runDate?: string, dep?: string, arr?: string) => {
    const safeDep = toPrettyHHMM(dep);
    const safeArr = toPrettyHHMM(arr);

    if (!runDate) return `${safeDep} → ${safeArr}`;

    const d = new Date(runDate);
    const label = d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });

    return `${label}, ${safeDep} → ${safeArr}`;
  };

  const minutesBetweenHHMM = (dep?: string, arr?: string) => {
    const depM = timeToMinutes(dep);
    const arrM = timeToMinutes(arr);
    if (depM == null || arrM == null) return null;
    const diff = arrM - depM;
    return diff >= 0 ? diff : null;
  };

  const formatDuration = (mins: number | null) => {
    if (mins == null) return "N/A";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  // -------------------------
  // Fetching
  // -------------------------
  const fetchData = async () => {
    try {
      const res = await fetch("/api/trains");
      const data = await res.json();
      const currentTime = new Date();

      const futureTrains = (data.trains || []).filter((train: any) => {
        const departureDate = new Date(train.runDate);
        return departureDate > currentTime;
      });

      setSchedules(futureTrains);
      setFilteredSchedules(futureTrains);
    } catch (error) {
      console.error("Error fetching train data:", error);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getAtocName = (code: string) => {
    const found = atoc.find((a) => a.code === code);
    return found ? found.name : code;
  };

  const fetchNewData = async () => {
    try {
      const fromObj = cities.find((c) => c.name === departureStation);
      const toObj = cities.find((c) => c.name === arrivalStation);
      const atocObj = atoc.find((a) => a.name === serviceProvider);

      const fromCode = fromObj?.code;
      const toCode = toObj?.code;
      const atocCode = atocObj?.code;

      if (!fromCode || !toCode || !atocCode) {
        console.error("Invalid input(s): from/to/atoc missing or incorrect");
        return;
      }

      const res = await fetch(
        `/api/getTrainInfo?from=${fromCode}&to=${toCode}&atoc=${atocCode}`
      );
      await res.json();
      fetchData();
    } catch (error) {
      console.error("Error fetching new train data:", error);
    }
  };

  const saveSettings = () => {
    sessionStorage.setItem("departureStation", departureStation);
    sessionStorage.setItem("arrivalStation", arrivalStation);
    sessionStorage.setItem("serviceProvider", serviceProvider);
    setModalOpen(false);
  };

  const filterSchedules = () => {
    const currentTime = new Date();
    let filtered = [...schedules];

    if (departureStation) {
      filtered = filtered.filter(
        (train) => train.locationDetail?.description === departureStation
      );
    }

    if (serviceProvider) {
      filtered = filtered.filter((train) => train.atocName === serviceProvider);
    }

    if (searchQuery) {
      filtered = filtered.filter((train) =>
        train.trainIdentity.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (!showPastTrains) {
      filtered = filtered.filter((train) => {
        const departureDate = new Date(train.runDate);
        return departureDate > currentTime;
      });
    }

    switch (sortType) {
      case "departure":
        filtered.sort((a: any, b: any) => {
          const aM = timeToMinutes(a.locationDetail?.gbttBookedDeparture);
          const bM = timeToMinutes(b.locationDetail?.gbttBookedDeparture);
          if (aM == null && bM == null) return 0;
          if (aM == null) return 1;
          if (bM == null) return -1;
          return aM - bM;
        });
        break;
      case "arrival":
        filtered.sort((a: any, b: any) => {
          // you're currently calculating arrival as +62 mins, so sort by that
          const aDep = a.locationDetail?.gbttBookedDeparture;
          const bDep = b.locationDetail?.gbttBookedDeparture;
          const aArr = addMinutesToHHmm(aDep, 62);
          const bArr = addMinutesToHHmm(bDep, 62);
          const aM = timeToMinutes(aArr);
          const bM = timeToMinutes(bArr);
          if (aM == null && bM == null) return 0;
          if (aM == null) return 1;
          if (bM == null) return -1;
          return aM - bM;
        });
        break;
      case "duration":
        // duration is fixed (62 mins), but keep it anyway
        break;
      default:
        break;
    }

    setFilteredSchedules(filtered);
  };

  useEffect(() => {
    filterSchedules();
  }, [departureStation, arrivalStation, serviceProvider, searchQuery, sortType, showPastTrains, schedules]);

  useEffect(() => {
    const storedDeparture = sessionStorage.getItem("departureStation");
    const storedArrival = sessionStorage.getItem("arrivalStation");
    const storedServiceProvider = sessionStorage.getItem("serviceProvider");

    if (storedDeparture) setDepartureStation(storedDeparture);
    if (storedArrival) setArrivalStation(storedArrival);
    if (storedServiceProvider) setServiceProvider(storedServiceProvider);
  }, []);

  // -------------------------
  // Modal open/close
  // -------------------------
  const openTrainModal = (train: any) => {
    setSelectedTrain(train);
    setTrainModalOpen(true);
  };

  const closeTrainModal = () => {
    setTrainModalOpen(false);
    setSelectedTrain(null);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <header className="text-center mb-8 relative">
        <h1 className="text-3xl md:text-4xl font-bold text-blue-800 flex items-center justify-center gap-3">
          <BsTrainFront className="text-3xl md:text-4xl" />
          My Commuter Train
        </h1>
        <p className="text-gray-600 mt-2">Track your commuter train</p>

        <BsGear
          className="absolute top-4 right-4 text-xl text-gray-600 cursor-pointer hover:text-gray-800"
          onClick={() => setModalOpen(true)}
        />
      </header>

      {/* SETTINGS MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white p-6 rounded-lg w-96">
            <h2 className="text-2xl font-semibold mb-4 text-black">Update Settings</h2>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2 text-black">
                Departure Station
              </label>
              <select
                value={departureStation}
                onChange={(e) => setDepartureStation(e.target.value)}
                className="w-full p-3 border border-black rounded-lg text-black"
              >
                <option value="">Select Departure Station</option>
                {cities.map((city) => (
                  <option key={city.code} value={city.name}>
                    {city.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2 text-black">
                Arrival Station
              </label>
              <select
                value={arrivalStation}
                onChange={(e) => setArrivalStation(e.target.value)}
                className="w-full p-3 border border-black rounded-lg text-black"
              >
                <option value="">Select Arrival Station</option>
                {cities.map((city) => (
                  <option key={city.code} value={city.name}>
                    {city.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2 text-black">
                Service Provider
              </label>
              <select
                value={serviceProvider}
                onChange={(e) => setServiceProvider(e.target.value)}
                className="w-full p-3 border border-black rounded-lg text-black"
              >
                <option value="">Select Service Provider</option>
                {atoc.map((option) => (
                  <option key={option.code} value={option.name}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-between">
              <button
                onClick={saveSettings}
                className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600"
              >
                Save
              </button>
              <button
                onClick={() => setModalOpen(false)}
                className="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TRAIN DETAILS MODAL (Fixed layout) */}
      {trainModalOpen && selectedTrain && (() => {
        const depHHmm = selectedTrain.locationDetail?.gbttBookedDeparture || "N/A";
        const arrHHmm = depHHmm !== "N/A" ? addMinutesToHHmm(depHHmm, 62) : "N/A";

        const depPretty = toPrettyHHMM(depHHmm);
        const arrPretty = toPrettyHHMM(arrHHmm);

        const originName =
          selectedTrain.locationDetail?.description || departureStation || "Origin";

        const destinationName =
          arrivalStation || "Destination";

        const operatorName = getAtocName(selectedTrain.atocName);

        const bikeSpaces = selectedTrain.bikeSpaces ?? 2;
        const reservationRequired = selectedTrain.reservationRequired ?? true;

        const depPlatform = selectedTrain.locationDetail?.platform || "N/A";
        const arrPlatform = "N/A"; // you don't have York platform in this payload

        const depStatus = selectedTrain.locationDetail?.status || "On time";
        const arrStatus = "On time";

        const durationLabel = formatDuration(minutesBetweenHHMM(depHHmm, arrHHmm));

        return (
          <div
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            onClick={closeTrainModal}
          >
            <div
              className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-8 py-6">
                <div className="flex items-center gap-3">
                  <h2 className="text-3xl font-semibold text-gray-900">Live tracker</h2>
                  <button
                    className="text-gray-600 hover:text-gray-900"
                    onClick={fetchNewData}
                    aria-label="Refresh"
                    title="Refresh"
                  >
                    <BsArrowRepeat className="text-xl" />
                  </button>
                </div>

                <button
                  onClick={closeTrainModal}
                  className="text-gray-900 font-medium hover:opacity-70"
                >
                  Close
                </button>
              </div>

              <div className="px-8 pb-10">
                {/* Date line */}
                <div className="flex items-center gap-3 mb-6">
                  <span className="w-3 h-3 rounded-full bg-green-500 ring-4 ring-green-100" />
                  <div className="text-lg font-semibold text-gray-900">
                    {fmtDateLine(selectedTrain.runDate, depHHmm, arrHHmm)}
                  </div>
                </div>

                {/* Operator + ID */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-gray-700 mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">🚆</span>
                    <span className="font-medium">{operatorName}</span>
                  </div>
                  <div className="text-gray-500">{selectedTrain.trainIdentity || "N/A"}</div>
                </div>

                {/* Bike + reservation */}
                <div className="flex flex-wrap items-center gap-3 text-gray-700 mb-10">
                  <span className="text-xl">🚲</span>
                  <span>{bikeSpaces} bike spaces</span>
                  <span className="text-gray-300">•</span>
                  <span className={reservationRequired ? "text-blue-700 underline underline-offset-2" : ""}>
                    {reservationRequired ? "Reservation required" : "No reservation needed"}
                  </span>
                </div>

                {/* ✅ TIMELINE (line centered to dot centers) */}
<div className="relative">
  {/* Line exactly centered with the dots */}
  <div className="absolute left-[14px] -translate-x-1/2 top-[28px] bottom-[38px] w-[3px] bg-gray-200 rounded-full" />

  <div className="grid grid-cols-[28px_110px_1fr] gap-x-6 gap-y-10">
    {/* Departure */}
    <div className="relative">
      <div className="absolute left-1/2 -translate-x-1/2 top-[6px] w-6 h-6 rounded-full bg-white border-4 border-gray-800" />
    </div>

    <div className="text-4xl font-semibold text-gray-900 tracking-tight leading-none">
      {depPretty}
    </div>

    <div>
      <div className="text-3xl font-semibold text-gray-900">{originName}</div>
      <div className="flex flex-wrap items-center gap-6 mt-2">
        <div className="text-green-700 font-medium">{depStatus}</div>
        <div className="text-gray-700">Plat. {depPlatform}</div>
      </div>
    </div>

    {/* Middle */}
    <div />
    <div className="text-gray-600">{durationLabel}</div>
    <button
      className="text-blue-700 hover:underline underline-offset-2 text-left"
      onClick={() => console.log("Stops:", selectedTrain.locationDetail?.destination)}
    >
      view stops
    </button>

    {/* Arrival */}
    <div className="relative">
      <div className="absolute left-1/2 -translate-x-1/2 top-[6px] w-6 h-6 rounded-full bg-gray-800" />
    </div>

    <div className="text-4xl font-semibold text-gray-900 tracking-tight leading-none">
      {arrPretty}
    </div>

    <div>
      <div className="text-3xl font-semibold text-gray-900">{destinationName}</div>
      <div className="flex flex-wrap items-center gap-6 mt-2">
        <div className="text-green-700 font-medium">{arrStatus}</div>
        <div className="text-gray-700">Plat. {arrPlatform}</div>
      </div>
    </div>
  </div>
</div>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="max-w-7xl mx-auto rounded-lg shadow-lg p-6 bg-white">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <select
            value={departureStation}
            onChange={(e) => setDepartureStation(e.target.value)}
            className="border border-black rounded p-2 w-full text-black"
          >
            <option value="">Select Departure City</option>
            {cities.map((city) => (
              <option key={city.code} value={city.name}>
                {city.name}
              </option>
            ))}
          </select>

          <select
            value={arrivalStation}
            onChange={(e) => setArrivalStation(e.target.value)}
            className="border border-black rounded p-2 w-full text-black"
          >
            <option value="">Select Arrival City</option>
            {cities.map((city) => (
              <option key={city.code} value={city.name}>
                {city.name}
              </option>
            ))}
          </select>

          <select
            value={serviceProvider}
            onChange={(e) => setServiceProvider(e.target.value)}
            className="border border-black rounded p-2 w-full text-black"
          >
            <option value="">Select Service Provider</option>
            {atoc.map((option) => (
              <option key={option.code} value={option.name}>
                {option.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-center mb-6">
          <button
            onClick={fetchNewData}
            className="p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
          >
            <BsArrowRepeat /> Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          {filteredSchedules.length > 0 ? (
            <table className="w-full text-gray-800">
              <thead>
                <tr className="bg-gray-200 text-left">
                  <th className="p-4">Date</th>
                  <th className="p-4">Train No.</th>
                  <th className="p-4">Departure</th>
                  <th className="p-4">Arrival</th>
                  <th className="p-4">Platform</th>
                  <th className="p-4">Provider</th>
                </tr>
              </thead>

              <tbody>
                {filteredSchedules.map((train, index) => {
                  const departureHHmm = train.locationDetail?.gbttBookedDeparture || "N/A";
                  const arrivalHHmm =
                    departureHHmm !== "N/A" ? addMinutesToHHmm(departureHHmm, 62) : "N/A";

                  return (
                    <tr
                      key={index}
                      className="border-t hover:bg-gray-100 cursor-pointer transition-colors"
                      onClick={() => openTrainModal(train)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") openTrainModal(train);
                      }}
                    >
                      <td className="p-4">{train.runDate}</td>
                      <td className="p-4 font-medium">{train.trainIdentity}</td>
                      <td className="p-4">{toPrettyHHMM(departureHHmm)}</td>
                      <td className="p-4">{toPrettyHHMM(arrivalHHmm)}</td>
                      <td className="p-4">{train.locationDetail?.platform || "N/A"}</td>
                      <td className="p-4">{getAtocName(train.atocName)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-8 text-gray-500">
              No trains found matching your criteria
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TrainScheduleFinder;
