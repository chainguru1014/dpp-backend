// What kind of business a company is, set when the super admin registers it
// (admin site, Companies page). Keys are stored; labels are what people see.
// Keep in sync with frontend/src/constants/companyTypes.js.
const COMPANY_TYPES: { key: string; label: string }[] = [
    { key: 'medicalPharma', label: 'Medical & Pharma' },
    { key: 'semiconductor', label: 'Semiconductor' },
    { key: 'automotive', label: 'Automotive' },
    { key: 'aircraft', label: 'Aircraft' },
    { key: 'defenseEquipment', label: 'Defense Equipment' },
    { key: 'bookstoreRfid', label: 'Bookstore RFID' },
    { key: 'foodBeverage', label: 'Food & Beverage' },
    { key: 'apparelTextiles', label: 'Apparel & Textiles' },
    { key: 'warehousingLogistics', label: 'Warehousing & Logistics' },
    { key: 'retailSupermarkets', label: 'Retail & Supermarkets' },
    { key: 'constructionSiteEquipment', label: 'Construction & Site Equipment' },
    { key: 'energyUtilities', label: 'Energy & Utilities' },
    { key: 'metalworkingManufacturing', label: 'Metalworking & Industrial Manufacturing' },
    { key: 'agricultureProducePacking', label: 'Agriculture & Produce Packing' },
    { key: 'railPublicTransport', label: 'Rail & Public Transport' },
    { key: 'maritimePorts', label: 'Maritime & Ports' },
    { key: 'commercialLaundryWorkwear', label: 'Commercial Laundry & Workwear' },
    { key: 'recyclingWasteManagement', label: 'Recycling & Waste Management' }
];

// Companies registered before types existed are Bookstore RFID.
const DEFAULT_COMPANY_TYPE = 'bookstoreRfid';
const COMPANY_TYPE_KEYS = COMPANY_TYPES.map((t) => t.key);

module.exports = { COMPANY_TYPES, COMPANY_TYPE_KEYS, DEFAULT_COMPANY_TYPE };
