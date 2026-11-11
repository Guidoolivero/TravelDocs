const estado = {
  passengers: [],
  reservations: [],
  currentEditId: null,
  alertConfig: {
    email: '',
    emailjsPublicKey: '',
    emailjsServiceId: '',
    emailjsTemplateId: '',
  },
  appName: 'TravelDocs',
  agencyName: '',
  currentUserRole: null,
  isPlatformAdmin: false,
  _alertsCheckedThisSession: false,
  _paxLoaded: false,
  _resLoaded: false
};

export { estado };
