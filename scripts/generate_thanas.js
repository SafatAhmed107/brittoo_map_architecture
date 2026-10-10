const fs = require('fs');

function makePoly(minLng, minLat, maxLng, maxLat) {
  return [
    [
      [Number(minLng.toFixed(4)), Number(minLat.toFixed(4))],
      [Number(maxLng.toFixed(4)), Number(minLat.toFixed(4))],
      [Number(maxLng.toFixed(4)), Number(maxLat.toFixed(4))],
      [Number(minLng.toFixed(4)), Number(maxLat.toFixed(4))],
      [Number(minLng.toFixed(4)), Number(minLat.toFixed(4))]
    ]
  ];
}

const features = [
  // --- DHAKA DIVISION: Core Dhaka City ---
  { thana: "Lalbagh", district: "Dhaka", division: "Dhaka Division", bounds: [90.380, 23.712, 90.398, 23.730] },
  { thana: "Shahbagh", district: "Dhaka", division: "Dhaka Division", bounds: [90.390, 23.725, 90.410, 23.745] },
  { thana: "Dhanmondi", district: "Dhaka", division: "Dhaka Division", bounds: [90.365, 23.735, 90.385, 23.760] },
  { thana: "Ramna", district: "Dhaka", division: "Dhaka Division", bounds: [90.398, 23.735, 90.418, 23.755] },
  { thana: "Paltan", district: "Dhaka", division: "Dhaka Division", bounds: [90.408, 23.728, 90.422, 23.742] },
  { thana: "Motijheel", district: "Dhaka", division: "Dhaka Division", bounds: [90.414, 23.722, 90.430, 23.738] },
  { thana: "Tejgaon", district: "Dhaka", division: "Dhaka Division", bounds: [90.382, 23.750, 90.402, 23.775] },
  { thana: "Tejgaon Industrial Area", district: "Dhaka", division: "Dhaka Division", bounds: [90.398, 23.760, 90.415, 23.778] },
  { thana: "Gulshan", district: "Dhaka", division: "Dhaka Division", bounds: [90.405, 23.780, 90.428, 23.805] },
  { thana: "Banani", district: "Dhaka", division: "Dhaka Division", bounds: [90.395, 23.785, 90.410, 23.808] },
  { thana: "Mirpur", district: "Dhaka", division: "Dhaka Division", bounds: [90.350, 23.795, 90.380, 23.830] },
  { thana: "Pallabi", district: "Dhaka", division: "Dhaka Division", bounds: [90.355, 23.820, 90.378, 23.845] },
  { thana: "Kafrul", district: "Dhaka", division: "Dhaka Division", bounds: [90.375, 23.785, 90.395, 23.805] },
  { thana: "Cantonment", district: "Dhaka", division: "Dhaka Division", bounds: [90.385, 23.805, 90.408, 23.835] },
  { thana: "Uttara", district: "Dhaka", division: "Dhaka Division", bounds: [90.375, 23.850, 90.415, 23.890] },
  { thana: "Uttarkhan", district: "Dhaka", division: "Dhaka Division", bounds: [90.410, 23.865, 90.435, 23.895] },
  { thana: "Dakshinkhan", district: "Dhaka", division: "Dhaka Division", bounds: [90.405, 23.845, 90.430, 23.875] },
  { thana: "Bimanbandar", district: "Dhaka", division: "Dhaka Division", bounds: [90.395, 23.835, 90.415, 23.860] },
  { thana: "Mohammadpur", district: "Dhaka", division: "Dhaka Division", bounds: [90.345, 23.750, 90.370, 23.778] },
  { thana: "Adabor", district: "Dhaka", division: "Dhaka Division", bounds: [90.345, 23.768, 90.365, 23.788] },
  { thana: "Hazaribagh", district: "Dhaka", division: "Dhaka Division", bounds: [90.355, 23.725, 90.375, 23.745] },
  { thana: "Chawkbazar", district: "Dhaka", division: "Dhaka Division", bounds: [90.390, 23.710, 90.405, 23.725] },
  { thana: "Kotwali", district: "Dhaka", division: "Dhaka Division", bounds: [90.400, 23.705, 90.412, 23.718] },
  { thana: "Sutrapur", district: "Dhaka", division: "Dhaka Division", bounds: [90.410, 23.700, 90.425, 23.718] },
  { thana: "Wari", district: "Dhaka", division: "Dhaka Division", bounds: [90.412, 23.712, 90.428, 23.725] },
  { thana: "Badda", district: "Dhaka", division: "Dhaka Division", bounds: [90.418, 23.768, 90.440, 23.798] },
  { thana: "Bhatara", district: "Dhaka", division: "Dhaka Division", bounds: [90.425, 23.795, 90.450, 23.825] },
  { thana: "Khilgaon", district: "Dhaka", division: "Dhaka Division", bounds: [90.420, 23.742, 90.445, 23.765] },
  { thana: "Rampura", district: "Dhaka", division: "Dhaka Division", bounds: [90.415, 23.755, 90.435, 23.775] },
  { thana: "Sabujbagh", district: "Dhaka", division: "Dhaka Division", bounds: [90.425, 23.730, 90.448, 23.750] },
  { thana: "Jatrabari", district: "Dhaka", division: "Dhaka Division", bounds: [90.425, 23.700, 90.455, 23.725] },
  { thana: "Demra", district: "Dhaka", division: "Dhaka Division", bounds: [90.445, 23.700, 90.485, 23.740] },
  { thana: "Kadamtali", district: "Dhaka", division: "Dhaka Division", bounds: [90.420, 23.685, 90.448, 23.710] },
  { thana: "Shyampur", district: "Dhaka", division: "Dhaka Division", bounds: [90.415, 23.690, 90.435, 23.708] },
  { thana: "Kamrangirchar", district: "Dhaka", division: "Dhaka Division", bounds: [90.360, 23.700, 90.385, 23.722] },
  { thana: "Turag", district: "Dhaka", division: "Dhaka Division", bounds: [90.350, 23.860, 90.385, 23.895] },
  { thana: "Darus Salam", district: "Dhaka", division: "Dhaka Division", bounds: [90.340, 23.780, 90.365, 23.805] },

  // --- Greater Dhaka Suburbs & Districts ---
  { thana: "Savar", district: "Dhaka", division: "Dhaka Division", bounds: [90.220, 23.820, 90.300, 23.920] },
  { thana: "Ashulia", district: "Dhaka", division: "Dhaka Division", bounds: [90.280, 23.870, 90.350, 23.950] },
  { thana: "Keraniganj", district: "Dhaka", division: "Dhaka Division", bounds: [90.310, 23.650, 90.410, 23.720] },
  { thana: "Gazipur Sadar", district: "Gazipur", division: "Dhaka Division", bounds: [90.340, 23.920, 90.450, 24.050] },
  { thana: "Tongi", district: "Gazipur", division: "Dhaka Division", bounds: [90.380, 23.880, 90.440, 23.930] },
  { thana: "Kaliakair", district: "Gazipur", division: "Dhaka Division", bounds: [90.180, 24.000, 90.300, 24.120] },
  { thana: "Narayanganj Sadar", district: "Narayanganj", division: "Dhaka Division", bounds: [90.460, 23.580, 90.540, 23.660] },
  { thana: "Bandar", district: "Narayanganj", division: "Dhaka Division", bounds: [90.510, 23.560, 90.580, 23.640] },
  { thana: "Sonargaon", district: "Narayanganj", division: "Dhaka Division", bounds: [90.550, 23.600, 90.660, 23.720] },
  { thana: "Narsingdi Sadar", district: "Narsingdi", division: "Dhaka Division", bounds: [90.680, 23.880, 90.760, 23.960] },
  { thana: "Manikganj Sadar", district: "Manikganj", division: "Dhaka Division", bounds: [89.950, 23.820, 90.050, 23.910] },
  { thana: "Munshiganj Sadar", district: "Munshiganj", division: "Dhaka Division", bounds: [90.480, 23.500, 90.580, 23.580] },
  { thana: "Tangail Sadar", district: "Tangail", division: "Dhaka Division", bounds: [89.880, 24.200, 89.980, 24.300] },
  { thana: "Kishoreganj Sadar", district: "Kishoreganj", division: "Dhaka Division", bounds: [90.740, 24.390, 90.840, 24.480] },
  { thana: "Faridpur Sadar", district: "Faridpur", division: "Dhaka Division", bounds: [89.780, 23.550, 89.880, 23.650] },
  { thana: "Gopalganj Sadar", district: "Gopalganj", division: "Dhaka Division", bounds: [89.780, 22.980, 89.880, 23.080] },
  { thana: "Madaripur Sadar", district: "Madaripur", division: "Dhaka Division", bounds: [90.150, 23.120, 90.250, 23.220] },

  // --- CHITTAGONG DIVISION ---
  { thana: "Kotwali", district: "Chittagong", division: "Chittagong Division", bounds: [91.820, 22.325, 91.848, 22.350] },
  { thana: "Panchlaish", district: "Chittagong", division: "Chittagong Division", bounds: [91.815, 22.355, 91.845, 22.385] },
  { thana: "Chandgaon", district: "Chittagong", division: "Chittagong Division", bounds: [91.838, 22.365, 91.870, 22.400] },
  { thana: "Double Mooring", district: "Chittagong", division: "Chittagong Division", bounds: [91.795, 22.320, 91.825, 22.345] },
  { thana: "Pahartali", district: "Chittagong", division: "Chittagong Division", bounds: [91.765, 22.345, 91.800, 22.380] },
  { thana: "Halishahar", district: "Chittagong", division: "Chittagong Division", bounds: [91.770, 22.300, 91.805, 22.335] },
  { thana: "Bakalia", district: "Chittagong", division: "Chittagong Division", bounds: [91.835, 22.330, 91.860, 22.360] },
  { thana: "Patenga", district: "Chittagong", division: "Chittagong Division", bounds: [91.780, 22.230, 91.820, 22.285] },
  { thana: "Khulshi", district: "Chittagong", division: "Chittagong Division", bounds: [91.790, 22.355, 91.820, 22.380] },
  { thana: "Bayazid", district: "Chittagong", division: "Chittagong Division", bounds: [91.800, 22.380, 91.835, 22.415] },
  { thana: "Hathazari", district: "Chittagong", division: "Chittagong Division", bounds: [91.780, 22.450, 91.860, 22.550] },
  { thana: "Comilla Sadar", district: "Comilla", division: "Chittagong Division", bounds: [91.150, 23.430, 91.220, 23.500] },
  { thana: "Comilla Sadar Dakshin", district: "Comilla", division: "Chittagong Division", bounds: [91.140, 23.360, 91.220, 23.440] },
  { thana: "Cox's Bazar Sadar", district: "Cox's Bazar", division: "Chittagong Division", bounds: [91.950, 21.400, 92.050, 21.500] },
  { thana: "Feni Sadar", district: "Feni", division: "Chittagong Division", bounds: [91.360, 22.980, 91.440, 23.060] },
  { thana: "Brahmanbaria Sadar", district: "Brahmanbaria", division: "Chittagong Division", bounds: [91.070, 23.920, 91.170, 24.020] },
  { thana: "Noakhali Sadar", district: "Noakhali", division: "Chittagong Division", bounds: [91.050, 22.800, 91.150, 22.900] },
  { thana: "Chandpur Sadar", district: "Chandpur", division: "Chittagong Division", bounds: [90.620, 23.180, 90.720, 23.280] },
  { thana: "Rangamati Sadar", district: "Rangamati", division: "Chittagong Division", bounds: [92.150, 22.600, 92.250, 22.700] },
  { thana: "Bandarban Sadar", district: "Bandarban", division: "Chittagong Division", bounds: [92.180, 22.150, 92.280, 22.250] },

  // --- RAJSHAHI DIVISION ---
  { thana: "Boalia", district: "Rajshahi", division: "Rajshahi Division", bounds: [88.580, 24.355, 88.615, 24.385] },
  { thana: "Motihar", district: "Rajshahi", division: "Rajshahi Division", bounds: [88.615, 24.350, 88.650, 24.380] },
  { thana: "Rajpara", district: "Rajshahi", division: "Rajshahi Division", bounds: [88.560, 24.365, 88.590, 24.395] },
  { thana: "Shah Makhdum", district: "Rajshahi", division: "Rajshahi Division", bounds: [88.590, 24.385, 88.630, 24.425] },
  { thana: "Bogura Sadar", district: "Bogura", division: "Rajshahi Division", bounds: [89.330, 24.810, 89.420, 24.900] },
  { thana: "Shajahanpur", district: "Bogura", division: "Rajshahi Division", bounds: [89.320, 24.720, 89.410, 24.810] },
  { thana: "Pabna Sadar", district: "Pabna", division: "Rajshahi Division", bounds: [89.200, 23.960, 89.280, 24.060] },
  { thana: "Ishwardi", district: "Pabna", division: "Rajshahi Division", bounds: [89.020, 24.080, 89.120, 24.180] },
  { thana: "Sirajganj Sadar", district: "Sirajganj", division: "Rajshahi Division", bounds: [89.660, 24.410, 89.750, 24.500] },
  { thana: "Natore Sadar", district: "Natore", division: "Rajshahi Division", bounds: [88.940, 24.370, 89.030, 24.460] },
  { thana: "Naogaon Sadar", district: "Naogaon", division: "Rajshahi Division", bounds: [88.900, 24.760, 88.990, 24.850] },
  { thana: "Chapainawabganj Sadar", district: "Chapainawabganj", division: "Rajshahi Division", bounds: [88.220, 24.550, 88.320, 24.650] },
  { thana: "Joypurhat Sadar", district: "Joypurhat", division: "Rajshahi Division", bounds: [89.000, 25.050, 89.100, 25.150] },

  // --- SYLHET DIVISION ---
  { thana: "Kotwali", district: "Sylhet", division: "Sylhet Division", bounds: [91.840, 24.870, 91.890, 24.915] },
  { thana: "Jalalabad", district: "Sylhet", division: "Sylhet Division", bounds: [91.810, 24.890, 91.860, 24.945] },
  { thana: "Shah Paran", district: "Sylhet", division: "Sylhet Division", bounds: [91.880, 24.895, 91.930, 24.945] },
  { thana: "South Surma", district: "Sylhet", division: "Sylhet Division", bounds: [91.850, 24.840, 91.900, 24.885] },
  { thana: "Airport", district: "Sylhet", division: "Sylhet Division", bounds: [91.840, 24.920, 91.890, 24.980] },
  { thana: "Moulvibazar Sadar", district: "Moulvibazar", division: "Sylhet Division", bounds: [91.740, 24.440, 91.820, 24.520] },
  { thana: "Sreemangal", district: "Moulvibazar", division: "Sylhet Division", bounds: [91.700, 24.270, 91.780, 24.350] },
  { thana: "Habiganj Sadar", district: "Habiganj", division: "Sylhet Division", bounds: [91.380, 24.340, 91.460, 24.420] },
  { thana: "Sunamganj Sadar", district: "Sunamganj", division: "Sylhet Division", bounds: [91.360, 25.030, 91.440, 25.110] },

  // --- KHULNA DIVISION ---
  { thana: "Khulna Sadar", district: "Khulna", division: "Khulna Division", bounds: [89.540, 22.800, 89.580, 22.840] },
  { thana: "Sonadanga", district: "Khulna", division: "Khulna Division", bounds: [89.520, 22.810, 89.555, 22.845] },
  { thana: "Khalishpur", district: "Khulna", division: "Khulna Division", bounds: [89.510, 22.845, 89.555, 22.880] },
  { thana: "Daulatpur", district: "Khulna", division: "Khulna Division", bounds: [89.495, 22.875, 89.540, 22.915] },
  { thana: "Jessore Sadar", district: "Jessore", division: "Khulna Division", bounds: [89.170, 23.130, 89.260, 23.210] },
  { thana: "Kushtia Sadar", district: "Kushtia", division: "Khulna Division", bounds: [89.080, 23.860, 89.170, 23.940] },
  { thana: "Jhenaidah Sadar", district: "Jhenaidah", division: "Khulna Division", bounds: [89.130, 23.500, 89.220, 23.580] },
  { thana: "Magura Sadar", district: "Magura", division: "Khulna Division", bounds: [89.380, 23.450, 89.460, 23.530] },
  { thana: "Satkhira Sadar", district: "Satkhira", division: "Khulna Division", bounds: [89.040, 22.680, 89.120, 22.760] },
  { thana: "Bagerhat Sadar", district: "Bagerhat", division: "Khulna Division", bounds: [89.760, 22.620, 89.840, 22.700] },

  // --- BARISAL DIVISION ---
  { thana: "Kotwali", district: "Barisal", division: "Barisal Division", bounds: [90.345, 22.680, 90.390, 22.725] },
  { thana: "Airport", district: "Barisal", division: "Barisal Division", bounds: [90.320, 22.730, 90.370, 22.790] },
  { thana: "Kawnia", district: "Barisal", division: "Barisal Division", bounds: [90.360, 22.705, 90.400, 22.745] },
  { thana: "Patuakhali Sadar", district: "Patuakhali", division: "Barisal Division", bounds: [90.290, 22.310, 90.370, 22.390] },
  { thana: "Bhola Sadar", district: "Bhola", division: "Barisal Division", bounds: [90.600, 22.650, 90.680, 22.730] },
  { thana: "Pirojpur Sadar", district: "Pirojpur", division: "Barisal Division", bounds: [89.950, 22.540, 90.030, 22.620] },

  // --- RANGPUR DIVISION ---
  { thana: "Kotwali", district: "Rangpur", division: "Rangpur Division", bounds: [89.220, 25.720, 89.280, 25.780] },
  { thana: "Tazhat", district: "Rangpur", division: "Rangpur Division", bounds: [89.245, 25.695, 89.290, 25.735] },
  { thana: "Dinajpur Sadar", district: "Dinajpur", division: "Rangpur Division", bounds: [88.600, 25.580, 88.680, 25.660] },
  { thana: "Saidpur", district: "Nilphamari", division: "Rangpur Division", bounds: [88.850, 25.740, 88.930, 25.820] },
  { thana: "Nilphamari Sadar", district: "Nilphamari", division: "Rangpur Division", bounds: [88.900, 25.900, 88.980, 25.980] },
  { thana: "Kurigram Sadar", district: "Kurigram", division: "Rangpur Division", bounds: [89.600, 25.780, 89.680, 25.860] },
  { thana: "Gaibandha Sadar", district: "Gaibandha", division: "Rangpur Division", bounds: [89.500, 25.290, 89.580, 25.370] },
  { thana: "Thakurgaon Sadar", district: "Thakurgaon", division: "Rangpur Division", bounds: [88.430, 26.000, 88.510, 26.080] },
  { thana: "Panchagarh Sadar", district: "Panchagarh", division: "Rangpur Division", bounds: [88.520, 26.300, 88.600, 26.380] },

  // --- MYMENSINGH DIVISION ---
  { thana: "Kotwali", district: "Mymensingh", division: "Mymensingh Division", bounds: [90.380, 24.720, 90.440, 24.780] },
  { thana: "Trishal", district: "Mymensingh", division: "Mymensingh Division", bounds: [90.350, 24.550, 90.430, 24.630] },
  { thana: "Muktagachha", district: "Mymensingh", division: "Mymensingh Division", bounds: [90.220, 24.720, 90.300, 24.800] },
  { thana: "Jamalpur Sadar", district: "Jamalpur", division: "Mymensingh Division", bounds: [89.900, 24.880, 89.980, 24.960] },
  { thana: "Netrokona Sadar", district: "Netrokona", division: "Mymensingh Division", bounds: [90.690, 24.840, 90.770, 24.920] },
  { thana: "Sherpur Sadar", district: "Sherpur", division: "Mymensingh Division", bounds: [90.000, 25.000, 90.080, 25.080] }
];

const geojson = {
  type: "FeatureCollection",
  features: features.map(f => ({
    type: "Feature",
    properties: {
      thana_name: f.thana,
      district_name: f.district,
      division_name: f.division
    },
    geometry: {
      type: "Polygon",
      coordinates: makePoly(f.bounds[0], f.bounds[1], f.bounds[2], f.bounds[3])
    }
  }))
};

fs.writeFileSync('public/geo/bd_thanas.min.geojson', JSON.stringify(geojson, null, 2));
console.log('Successfully generated', geojson.features.length, 'thanas covering all 8 divisions!');
