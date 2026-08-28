/* ============================================================
   WASHIFY — FINAL FIREBASE + REAL-TIME VERSION

   Features:
   - Google OAuth
   - Permanent username stored in Firestore
   - Firestore bookings
   - GLOBAL real-time booking visibility
   - Users can only manage their own bookings
   - One active booking per user
   - Machine availability visible to everyone
   - Demo mode
   - 15-minute confirmation
   - 5-minute confirmation window
   - Booking success animation
   - Cross-device synchronization
   ============================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyDQg1VsF1M2LUZtbPamdO7wjWLVJueFb1c",
  authDomain: "washify-a87ed.firebaseapp.com",
  projectId: "washify-a87ed",
  storageBucket: "washify-a87ed.firebasestorage.app",
  messagingSenderId: "84813198828",
  appId: "1:84813198828:web:e1eaaf5214507e54297cc9"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();


const APP = {

  // =========================================================
  // STATE
  // =========================================================

  state: {
    user: null,
    profile: null,

    // IMPORTANT:
    // This now contains ALL visible bookings,
    // not only the current user's bookings.
    bookings: [],

    demoMode: true,

    currentView: 'login',
    selectedMachine: null,

    isOnlineListener: false,
    isLoadingBookings: false,

    // Firestore unsubscribe function
    bookingUnsubscribe: null
  },


  // =========================================================
  // MACHINES
  // =========================================================

  machines: [
    {
      id: 'a',
      code: 'A',
      name: 'Iron Man'
    },
    {
      id: 'b',
      code: 'B',
      name: 'Captain America'
    },
    {
      id: 'c',
      code: 'C',
      name: 'Thor'
    }
  ],


  // =========================================================
  // TIME SETTINGS
  // =========================================================

  speedFactor: 60,

  SLOT_MS: 60 * 60 * 1000,

  // 15 minutes before booking
  CONFIRM_LEAD_MS: 15 * 60 * 1000,

  // 5 minute confirmation window
  CONFIRM_WINDOW_MS: 5 * 60 * 1000,


  // =========================================================
  // INITIALIZATION
  // =========================================================

  init() {

    this.bindEvents();

    this.tickHandle = setInterval(() => {
      this.tick();
    }, 1000);


    auth.onAuthStateChanged(async (user) => {

      if (user) {

        this.state.user = user;

        await this.loadProfile(user.uid);

        if (
          this.state.profile &&
          this.state.profile.username
        ) {

          await this.afterLogin();

        } else {

          this.showUsernameModal();
        }

      } else {

        this.cleanupBookingListener();

        this.state.user = null;
        this.state.profile = null;
        this.state.bookings = [];

        this.state.isOnlineListener = false;
        this.state.isLoadingBookings = false;

        this.state.selectedMachine = null;

        this.showView('login');
      }

      this.render();
    });
  },


  // =========================================================
  // PROFILE
  // =========================================================

  async loadProfile(uid) {

    try {

      const doc = await db
        .collection('users')
        .doc(uid)
        .get();

      this.state.profile =
        doc.exists ? doc.data() : null;

    } catch (e) {

      console.error('Profile load failed:', e);

      this.state.profile = null;
    }
  },


  async saveUsername(username) {

    if (!this.state.user) {
      throw new Error('Not authenticated');
    }

    const uid = this.state.user.uid;

    const profile = {
      username: username,
      email: this.state.user.email || '',
      createdAt:
        firebase.firestore.FieldValue.serverTimestamp()
    };

    await db
      .collection('users')
      .doc(uid)
      .set(profile, { merge: true });

    this.state.profile = {
      ...(this.state.profile || {}),
      ...profile
    };
  },


  // =========================================================
  // LOAD ALL BOOKINGS
  // =========================================================

  async loadBookings() {

    if (!this.state.user) {
      return;
    }

    this.state.isLoadingBookings = true;

    try {

      /*
       * IMPORTANT FIX
       *
       * DO NOT use:
       *
       * .where('userId', '==', this.state.user.uid)
       *
       * because Washify needs global machine availability.
       *
       * We load all authenticated-visible bookings.
       */

      const snap = await db
        .collection('bookings')
        .get();

      const all = [];

      snap.forEach((doc) => {

        all.push({
          id: doc.id,
          ...doc.data()
        });

      });

      this.state.bookings = all.sort(
        (a, b) =>
          (b.createdAt || 0) -
          (a.createdAt || 0)
      );

      this.render();

    } catch (e) {

      console.error(
        'Bookings load failed:',
        e
      );

      this.toast(
        'Failed to load bookings · check connection'
      );

    } finally {

      this.state.isLoadingBookings = false;
    }
  },


  // =========================================================
  // ADD BOOKING
  // =========================================================

  async addBooking(booking) {

    if (!this.state.user) {
      throw new Error('Not authenticated');
    }

    const { id, ...data } = booking;

    await db
      .collection('bookings')
      .doc(id)
      .set({

        ...data,

        userId: this.state.user.uid,

        userEmail:
          this.state.user.email || '',

        username:
          this.state.profile
            ? this.state.profile.username
            : 'User'
      });
  },


  // =========================================================
  // UPDATE BOOKING STATUS
  // =========================================================

  async updateBookingStatus(
    bookingId,
    newStatus
  ) {

    const booking =
      this.state.bookings.find(
        b => b.id === bookingId
      );

    if (!booking) {
      return;
    }

    /*
     * Only the owner is allowed to update
     * the booking under your Firestore rules.
     */

    if (
      !this.state.user ||
      booking.userId !== this.state.user.uid
    ) {

      console.warn(
        'Blocked status update for another user'
      );

      return;
    }

    await db
      .collection('bookings')
      .doc(bookingId)
      .update({
        status: newStatus
      });

    booking.status = newStatus;

    this.render();
  },


  // =========================================================
  // EVENT BINDING
  // =========================================================

  bindEvents() {

    document.body.addEventListener(
      'click',
      (e) => {

        const t = e.target;


        // -----------------------------------------------------
        // GOOGLE LOGIN
        // -----------------------------------------------------

        if (
          t.id === 'google-login-btn' ||
          t.closest('#google-login-btn')
        ) {

          this.handleGoogleLogin();

          return;
        }


        // -----------------------------------------------------
        // USERNAME FORM
        // -----------------------------------------------------

        if (
          t.closest('#username-form button')
        ) {

          e.preventDefault();

          this.handleSaveUsername();

          return;
        }


        // -----------------------------------------------------
        // MACHINE ACTION BUTTONS
        // -----------------------------------------------------

        const cta =
          t.closest('[data-action]');

        if (cta) {

          e.stopPropagation();

          const action =
            cta.dataset.action;

          const mid =
            cta.dataset.machine;


          if (action === 'use-now') {

            this.walkIn(mid);

          } else if (action === 'book') {

            this.openMachine(mid);

          } else if (action === 'view') {

            this.openMachine(mid);

          } else if (action === 'mark-done') {

            this.markDone(mid);
          }

          return;
        }


        // -----------------------------------------------------
        // MACHINE CARD
        // -----------------------------------------------------

        const card =
          t.closest('.machine-card');

        if (
          card &&
          !t.closest('.machine-cta')
        ) {

          this.openMachine(
            card.dataset.id
          );

          return;
        }


        // -----------------------------------------------------
        // SLOT
        // -----------------------------------------------------

        const slot =
          t.closest(
            '.slot:not(.past):not(.taken):not(.mine):not(.running)'
          );

        if (slot) {

          this.bookSlot(
            slot.dataset.machine,
            parseInt(
              slot.dataset.start,
              10
            )
          );

          return;
        }


        // -----------------------------------------------------
        // CANCEL
        // -----------------------------------------------------

        const cancelBtn =
          t.closest('[data-cancel]');

        if (cancelBtn) {

          this.cancelBooking(
            cancelBtn.dataset.cancel
          );

          return;
        }


        // -----------------------------------------------------
        // BACK
        // -----------------------------------------------------

        if (t.closest('[data-back]')) {

          this.state.selectedMachine = null;

          this.showView('dashboard');

          this.render();

          return;
        }


        // -----------------------------------------------------
        // LOGOUT
        // -----------------------------------------------------

        if (t.closest('[data-logout]')) {

          this.logout();

          return;
        }


        // -----------------------------------------------------
        // SUCCESS OVERLAY
        // -----------------------------------------------------

        if (
          t.id === 'success-done-btn' ||
          t.closest('#success-done-btn')
        ) {

          const overlay =
            document.getElementById(
              'booking-success'
            );

          if (overlay) {
            overlay.classList.add('hidden');
          }

          return;
        }


        if (t.id === 'booking-success') {

          const overlay =
            document.getElementById(
              'booking-success'
            );

          if (overlay) {
            overlay.classList.add('hidden');
          }

          return;
        }

      }
    );


    // ---------------------------------------------------------
    // USERNAME FORM
    // ---------------------------------------------------------

    const usernameForm =
      document.getElementById(
        'username-form'
      );

    if (usernameForm) {

      usernameForm.addEventListener(
        'submit',
        (e) => {

          e.preventDefault();

          this.handleSaveUsername();
        }
      );
    }


    // ---------------------------------------------------------
    // DEMO TOGGLE
    // ---------------------------------------------------------

    const demoToggle =
      document.getElementById(
        'demo-toggle'
      );

    if (demoToggle) {

      demoToggle.addEventListener(
        'change',
        (e) => {

          this.state.demoMode =
            e.target.checked;

          this._demoBase = this.now();

          this._demoStart =
            Date.now();

          this.render();
        }
      );
    }


    // ---------------------------------------------------------
    // AWAITING CONFIRMATION
    // ---------------------------------------------------------

    const awaitingConfirm =
      document.getElementById(
        'awaiting-confirm'
      );

    if (awaitingConfirm) {

      awaitingConfirm.addEventListener(
        'click',
        () => {

          const a =
            this.awaitingBooking();

          if (a) {

            this.confirmBooking(a.id);

            this.toast(
              'Slot confirmed · see you there'
            );

            this.render();
          }
        }
      );
    }


    const awaitingCancel =
      document.getElementById(
        'awaiting-cancel'
      );

    if (awaitingCancel) {

      awaitingCancel.addEventListener(
        'click',
        () => {

          const a =
            this.awaitingBooking();

          if (a) {

            this.cancelBooking(a.id);

            this.toast(
              'Slot released back to pool'
            );

            this.render();
          }
        }
      );
    }
  },


  // =========================================================
  // AUTH
  // =========================================================

  async handleGoogleLogin() {

    const btn =
      document.getElementById(
        'google-login-btn'
      );

    const btnText =
      document.getElementById(
        'google-btn-text'
      );


    if (btn) {
      btn.disabled = true;
    }

    if (btnText) {
      btnText.textContent =
        'Signing in…';
    }


    try {

      await auth.signInWithPopup(
        googleProvider
      );

    } catch (e) {

      console.error(
        'Google login failed:',
        e
      );

      const errorEl =
        document.getElementById(
          'login-error'
        );

      if (errorEl) {

        errorEl.textContent =
          'Sign-in failed: ' +
          (e.message || 'try again');
      }


      if (btn) {
        btn.disabled = false;
      }

      if (btnText) {
        btnText.textContent =
          'Continue with Google';
      }
    }
  },


  async handleSaveUsername() {

    const input =
      document.getElementById(
        'new-username'
      );

    const errorEl =
      document.getElementById(
        'username-error'
      );

    if (!input) {
      return;
    }

    const username =
      input.value.trim();


    if (!/^\d+\s+\S+/.test(username)) {

      if (errorEl) {

        errorEl.textContent =
          'Use format: [Room No] Name (e.g., 204 Arjun)';
      }

      return;
    }


    try {

      await this.saveUsername(
        username
      );

      const modal =
        document.getElementById(
          'username-modal'
        );

      if (modal) {
        modal.classList.add('hidden');
      }

      await this.afterLogin();

    } catch (e) {

      console.error(
        'Username save failed:',
        e
      );

      if (errorEl) {

        errorEl.textContent =
          'Failed to save: ' +
          e.message;
      }
    }
  },


  async logout() {

    this.cleanupBookingListener();


    try {

      await auth.signOut();

    } catch (e) {

      console.warn(
        'Logout error:',
        e
      );
    }


    this.state.user = null;

    this.state.profile = null;

    this.state.bookings = [];

    this.state.selectedMachine = null;

    this.state.isOnlineListener = false;

    this.showView('login');

    this.render();
  },


  // =========================================================
  // AFTER LOGIN
  // =========================================================

  async afterLogin() {

    this.showView('dashboard');


    if (
      this.state.profile &&
      this.state.profile.username
    ) {

      this.toast(
        `Welcome, ${this.state.profile.username}`
      );
    }


    /*
     * IMPORTANT:
     * Load ALL bookings before dashboard
     * and then start global listener.
     */

    await this.loadBookings();

    this.startBookingListener();

    this.render();
  },


  // =========================================================
  // CLEANUP REAL-TIME LISTENER
  // =========================================================

  cleanupBookingListener() {

    if (
      typeof this.state.bookingUnsubscribe ===
      'function'
    ) {

      try {

        this.state.bookingUnsubscribe();

      } catch (e) {

        console.warn(
          'Listener cleanup failed:',
          e
        );
      }
    }


    this.state.bookingUnsubscribe =
      null;

    this.state.isOnlineListener =
      false;
  },


  // =========================================================
  // GLOBAL REAL-TIME BOOKING LISTENER
  // =========================================================

  startBookingListener() {

    if (
      this.state.isOnlineListener ||
      !this.state.user
    ) {

      return;
    }


    this.state.isOnlineListener =
      true;


    /*
     * IMPORTANT FIX:
     *
     * OLD:
     *
     * .where('userId', '==', currentUser.uid)
     *
     * NEW:
     *
     * Listen to ALL authenticated-visible bookings.
     *
     * This allows every user to see machine availability.
     */

    const unsubscribe =
      db.collection('bookings')
        .onSnapshot(
          (snap) => {

            const all = [];

            snap.forEach((doc) => {

              all.push({
                id: doc.id,
                ...doc.data()
              });

            });


            /*
             * Keep a complete global booking state.
             *
             * userActiveBookings() filters this
             * to the current user when needed.
             */

            this.state.bookings =
              all.sort(
                (a, b) =>
                  (b.createdAt || 0) -
                  (a.createdAt || 0)
              );


            this.render();

          },

          (err) => {

            console.error(
              'Global booking listener error:',
              err
            );

            this.state.isOnlineListener =
              false;

            this.toast(
              'Real-time sync unavailable'
            );
          }
        );


    this.state.bookingUnsubscribe =
      unsubscribe;
  },


  // =========================================================
  // USERNAME MODAL
  // =========================================================

  showUsernameModal() {

    const modal =
      document.getElementById(
        'username-modal'
      );

    if (modal) {
      modal.classList.remove('hidden');
    }


    if (!this.state.user) {
      return;
    }


    const email =
      this.state.user.email
        ? this.state.user.email.split('@')[0]
        : 'Student';


    const greeting =
      document.getElementById(
        'user-greeting'
      );

    if (greeting) {

      greeting.textContent =
        email.charAt(0).toUpperCase() +
        email.slice(1);
    }


    setTimeout(() => {

      const input =
        document.getElementById(
          'new-username'
        );

      if (input) {
        input.focus();
      }

    }, 300);
  },


  // =========================================================
  // TIME
  // =========================================================

  now() {
  return Date.now();
},
  tick() {

    this.updateBookings();

    this.updateClocks();

    this.updateMachineCards();

    this.updateAwaitingBanner();


    if (
      this.state.currentView ===
      'machine-detail'
    ) {

      this.updateSlotGrid();
    }
  },


  // =========================================================
  // AUTOMATIC BOOKING STATUS
  // =========================================================

  updateBookings() {

    const now =
      this.now();


    for (
      const b of this.state.bookings
    ) {


      // -----------------------------------------------------
      // BOOKED → AWAITING CONFIRMATION
      // -----------------------------------------------------

      if (
        b.status === 'booked' &&
        now >=
          b.startTime -
          this.CONFIRM_LEAD_MS &&
        now <
          b.startTime
      ) {

        b.status =
          'awaiting_confirmation';

        b.confirmationDeadline =
          b.startTime -
          this.CONFIRM_WINDOW_MS;


        /*
         * Only the booking owner should
         * write status under our rules.
         */

        if (
          this.state.user &&
          b.userId ===
            this.state.user.uid
        ) {

          this.persistStatus(
            b.id,
            'awaiting_confirmation'
          );
        }

      }


      // -----------------------------------------------------
      // AWAITING → EXPIRED
      // -----------------------------------------------------

      else if (
        b.status ===
          'awaiting_confirmation' &&
        b.confirmationDeadline &&
        now >=
          b.confirmationDeadline
      ) {

        b.status =
          'expired';


        if (
          this.state.user &&
          b.userId ===
            this.state.user.uid
        ) {

          this.persistStatus(
            b.id,
            'expired'
          );
        }
      }


      // -----------------------------------------------------
      // CONFIRMED → RUNNING
      // -----------------------------------------------------

      else if (
        b.status === 'confirmed' &&
        now >= b.startTime &&
        now < b.endTime
      ) {

        b.status =
          'running';


        if (
          this.state.user &&
          b.userId ===
            this.state.user.uid
        ) {

          this.persistStatus(
            b.id,
            'running'
          );
        }
      }


      // -----------------------------------------------------
      // RUNNING → COMPLETED
      // -----------------------------------------------------

      else if (
        b.status === 'running' &&
        now >= b.endTime
      ) {

        b.status =
          'completed';


        if (
          this.state.user &&
          b.userId ===
            this.state.user.uid
        ) {

          this.persistStatus(
            b.id,
            'completed'
          );
        }
      }
    }
  },


  async persistStatus(
    id,
    status
  ) {

    try {

      await db
        .collection('bookings')
        .doc(id)
        .update({
          status: status
        });

    } catch (e) {

      console.warn(
        'Status sync failed:',
        e
      );
    }
  },


  // =========================================================
  // QUERIES
  // =========================================================

  awaitingBooking() {

    if (!this.state.user) {
      return null;
    }


    return this.state.bookings.find(
      b =>
        b.userId ===
          this.state.user.uid &&
        b.status ===
          'awaiting_confirmation'
    ) || null;
  },


  // ---------------------------------------------------------
  // CURRENT USER'S ACTIVE BOOKINGS
  // ---------------------------------------------------------

  userActiveBookings() {

    if (!this.state.user) {
      return [];
    }


    return this.state.bookings.filter(
      b =>
        b.userId ===
          this.state.user.uid &&

        [
          'booked',
          'awaiting_confirmation',
          'confirmed',
          'running'
        ].includes(b.status)
    );
  },


  // ---------------------------------------------------------
  // GLOBAL MACHINE STATUS
  // ---------------------------------------------------------

  getMachineStatus(machineId) {

    /*
     * IMPORTANT:
     * This checks ALL bookings,
     * not only current user's bookings.
     */

    const now =
      this.now();


    const active =
      this.state.bookings.find(
        b => {

          if (
            b.machineId !==
            machineId
          ) {

            return false;
          }


          if (
            ![
              'booked',
              'awaiting_confirmation',
              'confirmed',
              'running'
            ].includes(b.status)
          ) {

            return false;
          }


          /*
           * Ignore bookings that are
           * completely in the past.
           */

          if (
            b.endTime &&
            b.endTime <= now
          ) {

            return false;
          }


          return true;
        }
      );


    if (!active) {

      return {
        status: 'free'
      };
    }


    return {
      status: active.status,
      booking: active
    };
  },


  // =========================================================
  // BOOK SLOT
  // =========================================================

  async bookSlot(
    machineId,
    startTime
  ) {


    // -------------------------------------------------------
    // USER CAN ONLY HAVE ONE ACTIVE BOOKING
    // -------------------------------------------------------

    if (
      this.userActiveBookings().length > 0
    ) {

      this.toast(
        'You already have an active booking · cancel it first'
      );

      return;
    }


    // -------------------------------------------------------
    // CHECK GLOBAL STATE
    // -------------------------------------------------------

    const taken =
      this.state.bookings.find(
        b =>
          b.machineId ===
            machineId &&

          b.startTime ===
            startTime &&

          [
            'booked',
            'awaiting_confirmation',
            'confirmed',
            'running'
          ].includes(b.status)
      );


    if (taken) {

      this.toast(
        'That slot was just taken · pick another'
      );

      return;
    }


    // -------------------------------------------------------
    // CREATE BOOKING
    // -------------------------------------------------------

    const booking = {

      id:
        'bk_' +
        Date.now() +
        '_' +
        Math.random()
          .toString(36)
          .slice(2, 6),

      machineId:

        machineId,

      startTime:

        startTime,

      endTime:

        startTime +
        this.SLOT_MS,

      status:

        'booked',

      confirmationDeadline:

        null,

      createdAt:

        this.now(),

      token:

        'T-' +
        (
          Math.floor(
            Math.random() * 90
          ) + 10
        )
    };


    // -------------------------------------------------------
    // LOCAL UPDATE FIRST
    // -------------------------------------------------------

    this.state.bookings.unshift(
      {
        ...booking,

        userId:
          this.state.user.uid,

        userEmail:
          this.state.user.email || '',

        username:
          this.state.profile
            ? this.state.profile.username
            : 'User'
      }
    );


    this.render();


    // -------------------------------------------------------
    // SUCCESS ANIMATION
    // -------------------------------------------------------

    this.showBookingSuccess(
      booking,
      'booked'
    );


    // -------------------------------------------------------
    // FIRESTORE
    // -------------------------------------------------------

    try {

      await this.addBooking(
        booking
      );

    } catch (e) {

      console.error(
        'Book save failed:',
        e
      );


      this.state.bookings =
        this.state.bookings.filter(
          b =>
            b.id !==
            booking.id
        );


      this.render();


      this.toast(
        'Failed to save · check connection · booking rolled back'
      );
    }
  },


  // =========================================================
  // WALK-IN / USE NOW
  // =========================================================

  async walkIn(machineId) {


    // -------------------------------------------------------
    // ONE ACTIVE BOOKING
    // -------------------------------------------------------

    if (
      this.userActiveBookings().length > 0
    ) {

      this.toast(
        'You already have an active booking'
      );

      return;
    }


    // -------------------------------------------------------
    // MACHINE MUST BE FREE
    // -------------------------------------------------------

    const status =
      this.getMachineStatus(
        machineId
      );


    if (
      status.status !==
      'free'
    ) {

      this.toast(
        'Machine is not free'
      );

      return;
    }


    const start =
      this.now();


    const booking = {

      id:
        'bk_' +
        Date.now() +
        '_' +
        Math.random()
          .toString(36)
          .slice(2, 6),

      machineId:

        machineId,

      startTime:

        start,

      endTime:

        start +
        this.SLOT_MS,

      status:

        'running',

      confirmationDeadline:

        null,

      createdAt:

        start,

      token:

        'T-' +
        (
          Math.floor(
            Math.random() * 90
          ) + 10
        )
    };


    // -------------------------------------------------------
    // LOCAL STATE
    // -------------------------------------------------------

    this.state.bookings.unshift(
      {
        ...booking,

        userId:
          this.state.user.uid,

        userEmail:
          this.state.user.email || '',

        username:
          this.state.profile
            ? this.state.profile.username
            : 'User'
      }
    );


    this.render();


    // -------------------------------------------------------
    // SUCCESS
    // -------------------------------------------------------

    this.showBookingSuccess(
      booking,
      'running'
    );


    // -------------------------------------------------------
    // FIRESTORE
    // -------------------------------------------------------

    try {

      await this.addBooking(
        booking
      );

    } catch (e) {

      console.error(
        'Walk-in save failed:',
        e
      );


      this.state.bookings =
        this.state.bookings.filter(
          b =>
            b.id !==
            booking.id
        );


      this.render();


      this.toast(
        'Failed to save · check connection · booking rolled back'
      );
    }
  },


  // =========================================================
  // CONFIRM BOOKING
  // =========================================================

  async confirmBooking(id) {

    const b =
      this.state.bookings.find(
        x => x.id === id
      );


    if (!b) {
      return;
    }


    if (
      !this.state.user ||
      b.userId !==
        this.state.user.uid
    ) {

      this.toast(
        'You cannot confirm this booking'
      );

      return;
    }


    b.status =
      'confirmed';


    this.render();


    try {

      await db
        .collection('bookings')
        .doc(id)
        .update({
          status: 'confirmed'
        });

    } catch (e) {

      console.warn(
        'Confirm sync failed:',
        e
      );

      this.toast(
        'Failed to confirm · check connection'
      );
    }
  },


  // =========================================================
  // CANCEL BOOKING
  // =========================================================

  async cancelBooking(id) {

    const b =
      this.state.bookings.find(
        x => x.id === id
      );


    if (!b) {
      return;
    }


    if (
      !this.state.user ||
      b.userId !==
        this.state.user.uid
    ) {

      this.toast(
        'You cannot cancel this booking'
      );

      return;
    }


    b.status =
      'cancelled';


    this.render();


    this.toast(
      'Booking cancelled'
    );


    try {

      await db
        .collection('bookings')
        .doc(id)
        .update({
          status: 'cancelled'
        });

    } catch (e) {

      console.error(
        'Cancel sync failed:',
        e
      );

      this.toast(
        'Failed to sync cancellation'
      );
    }
  },


  // =========================================================
  // DONE EARLY
  // =========================================================

  async markDone(machineId) {

    const b =
      this.state.bookings.find(
        x =>
          x.machineId ===
            machineId &&

          x.userId ===
            this.state.user.uid &&

          x.status ===
            'running'
      );


    if (!b) {
      return;
    }


    b.status =
      'completed';


    b.endTime =
      this.now();


    this.render();


    this.toast(
      'Machine freed'
    );


    try {

      await db
        .collection('bookings')
        .doc(b.id)
        .update({

          status:
            'completed',

          endTime:
            b.endTime
        });

    } catch (e) {

      console.warn(
        'Mark done sync failed:',
        e
      );
    }
  },


  // =========================================================
  // OPEN MACHINE
  // =========================================================

  openMachine(id) {

    this.state.selectedMachine =
      id;

    this.showView(
      'machine-detail'
    );

    this.render();
  },


  // =========================================================
  // SUCCESS OVERLAY
  // =========================================================

  showBookingSuccess(
    booking,
    kind
  ) {

    const overlay =
      document.getElementById(
        'booking-success'
      );

    const headline =
      document.getElementById(
        'success-headline'
      );


    if (!overlay || !headline) {
      return;
    }


    const m =
      this.machines.find(
        x =>
          x.id ===
          booking.machineId
      );


    if (!m) {
      return;
    }


    const startDate =
      new Date(
        booking.startTime
      );

    const endDate =
      new Date(
        booking.endTime
      );


    headline.textContent =
      kind === 'running'
        ? 'Machine Started!'
        : 'Slot Booked!';


    const usernameEl =
      document.getElementById(
        'success-username'
      );

    const machineEl =
      document.getElementById(
        'success-machine'
      );

    const startEl =
      document.getElementById(
        'success-start'
      );

    const endEl =
      document.getElementById(
        'success-end'
      );

    const tokenEl =
      document.getElementById(
        'success-token'
      );

    const idEl =
      document.getElementById(
        'success-id'
      );


    if (usernameEl) {

      usernameEl.textContent =
        this.state.profile
          ? this.state.profile.username
          : 'User';
    }


    if (machineEl) {

      machineEl.textContent =
        `${m.name} (Machine ${m.code})`;
    }


    if (startEl) {

      startEl.textContent =
        this.fmtSlotFull(
          booking.startTime
        );
    }


    if (endEl) {

      endEl.textContent =
        this.fmtSlotFull(
          booking.endTime
        );
    }


    if (tokenEl) {

      tokenEl.textContent =
        booking.token || '—';
    }


    if (idEl) {

      idEl.textContent =
        booking.id;
    }


    const msgBox =
      document.querySelector(
        '.success-msg'
      );

    const msgText =
      document.getElementById(
        'success-message'
      );


    if (
      msgBox &&
      msgText
    ) {

      if (
        kind === 'running'
      ) {

        msgText.textContent =
          `Running for 1 hour · ends at ${this.fmtTime(endDate)} · others see you on the dashboard`;

        msgBox.classList.add(
          'running'
        );

      } else {

        msgText.textContent =
          '15 min before start we will ask you to confirm · slot auto-releases if you ignore it';

        msgBox.classList.remove(
          'running'
        );
      }
    }


    overlay.classList.remove(
      'hidden'
    );


    this.startSuccessConfetti();
  },


  // =========================================================
  // SUCCESS CONFETTI
  // =========================================================

  startSuccessConfetti() {

    const canvas =
      document.getElementById(
        'success-confetti'
      );


    if (!canvas) {
      return;
    }


    const ctx =
      canvas.getContext('2d');


    canvas.width =
      canvas.offsetWidth;

    canvas.height =
      canvas.offsetHeight;


    const colors = [
      '#1E8449',
      '#26A69A',
      '#FFCA28',
      '#BA4A00',
      '#2471A3',
      '#7C4DFF',
      '#E74C3C'
    ];


    const particles =
      Array.from(
        { length: 100 },
        () => ({

          x:
            Math.random() *
            canvas.width,

          y:
            -20,

          r:
            Math.random() *
              5 +
            2,

          c:
            colors[
              Math.floor(
                Math.random() *
                colors.length
              )
            ],

          vy:
            Math.random() *
              2 +
            1.5,

          vx:
            (
              Math.random() -
              0.5
            ) * 2,

          rot:
            Math.random() *
            Math.PI *
            2,

          vr:
            (
              Math.random() -
              0.5
            ) * 0.15
        })
      );


    let frame = 0;


    const draw = () => {

      ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );


      particles.forEach(
        p => {

          p.y += p.vy;

          p.x += p.vx;

          p.rot += p.vr;


          ctx.save();

          ctx.translate(
            p.x,
            p.y
          );

          ctx.rotate(
            p.rot
          );


          ctx.fillStyle =
            p.c;


          ctx.fillRect(
            -p.r,
            -p.r,
            p.r * 2,
            p.r * 2
          );


          ctx.restore();
        }
      );


      frame++;


      if (frame < 250) {

        requestAnimationFrame(
          draw
        );

      } else {

        ctx.clearRect(
          0,
          0,
          canvas.width,
          canvas.height
        );
      }
    };


    draw();
  },


  // =========================================================
  // VIEW
  // =========================================================

  showView(name) {

    this.state.currentView =
      name;


    document
      .querySelectorAll(
        '.screen'
      )
      .forEach(
        s =>
          s.classList.add(
            'hidden'
          )
      );


    const el =
      document.getElementById(
        name
      );


    if (el) {

      el.classList.remove(
        'hidden'
      );
    }
  },


  // =========================================================
  // MAIN RENDER
  // =========================================================

  render() {

    if (
      this.state.currentView ===
        'dashboard' &&
      this.state.profile
    ) {

      this.renderDashboard();

    } else if (
      this.state.currentView ===
      'machine-detail'
    ) {

      this.renderMachineDetail();
    }


    this.updateClocks();


    const dt =
      document.getElementById(
        'demo-toggle'
      );


    if (dt) {

      dt.checked =
        this.state.demoMode;
    }
  },


  // =========================================================
  // CLOCK
  // =========================================================

  updateClocks() {

    const now =
      new Date(
        this.now()
      );


    const str =
      `${String(
        now.getHours()
      ).padStart(2, '0')}:` +

      `${String(
        now.getMinutes()
      ).padStart(2, '0')}:` +

      `${String(
        now.getSeconds()
      ).padStart(2, '0')}`;


    document
      .querySelectorAll(
        '.clock'
      )
      .forEach(
        el =>
          el.textContent =
            str
      );
  },


  // =========================================================
  // DASHBOARD
  // =========================================================

  renderDashboard() {

    const userChip =
      document.getElementById(
        'user-chip'
      );


    if (userChip) {

      userChip.innerHTML =
        `<strong>${this.state.profile.username}</strong>`;
    }


    const grid =
      document.getElementById(
        'machine-grid'
      );


    if (!grid) {
      return;
    }


    grid.innerHTML =
      this.machines
        .map(
          m => {

            const s =
              this.getMachineStatus(
                m.id
              );


            return `
              <div class="machine-card" data-id="${m.id}">

                <div class="porthole ${s.status}">
                  <div class="drum"></div>
                  <div class="water"></div>
                </div>

                <div class="machine-info">

                  <div class="machine-letter">
                    MACHINE ${m.code}
                  </div>

                  <div class="machine-name">
                    ${m.name}
                  </div>

                </div>

              </div>
            `;
          }
        )
        .join('');


    this.renderMyBookings();

    this.updateAwaitingBanner();
  },


  // =========================================================
  // MACHINE CARD STATUS
  // =========================================================

  updateMachineCards() {

    if (
      this.state.currentView !==
      'dashboard'
    ) {

      return;
    }


    this.machines.forEach(
      m => {

        const card =
          document.querySelector(
            `.machine-card[data-id="${m.id}"]`
          );


        if (!card) {
          return;
        }


        const status =
          this.getMachineStatus(
            m.id
          );


        const porthole =
          card.querySelector(
            '.porthole'
          );


        if (!porthole) {
          return;
        }


        const oldCls =
          porthole.className;


        const newCls =
          'porthole ' +
          status.status;


        if (
          oldCls !==
          newCls
        ) {

          porthole.className =
            newCls;
        }
      }
    );
  },


  // =========================================================
  // MY BOOKINGS
  // =========================================================

  renderMyBookings() {

    const list =
      document.getElementById(
        'my-bookings'
      );


    if (!list) {
      return;
    }


    /*
     * IMPORTANT:
     * Even though state.bookings contains
     * everybody's bookings, this function
     * shows ONLY the current user's bookings.
     */

    const mine =
      this.userActiveBookings();


    if (mine.length === 0) {

      list.innerHTML =
        '<div class="empty-bookings">No active bookings · tap a free machine</div>';

      return;
    }


    const now =
      this.now();


    list.innerHTML =
      mine
        .map(
          b => {

            const m =
              this.machines.find(
                x =>
                  x.id ===
                  b.machineId
              );


            if (!m) {
              return '';
            }


            let label = '';

            let timeInfo =
              this.fmtSlot(
                b.startTime,
                b.endTime
              );

            let actionHtml = '';


            if (
              b.status ===
              'booked'
            ) {

              label =
                'Booked';

              timeInfo +=
                ` · starts in ${this.fmtDur(
                  b.startTime - now
                )}`;

              actionHtml =
                `<button class="btn-cancel" data-cancel="${b.id}">Cancel</button>`;

            }


            else if (
              b.status ===
              'awaiting_confirmation'
            ) {

              label =
                'Awaiting confirmation';

              timeInfo +=
                ` · starts in ${this.fmtDur(
                  b.startTime - now
                )}`;

              actionHtml =
                `<button class="btn-cancel" data-cancel="${b.id}">Cancel</button>`;

            }


            else if (
              b.status ===
              'confirmed'
            ) {

              label =
                'Confirmed';

              timeInfo +=
                ` · starts in ${this.fmtDur(
                  b.startTime - now
                )}`;

              actionHtml =
                `<button class="btn-cancel" data-cancel="${b.id}">Cancel</button>`;

            }


            else if (
              b.status ===
              'running'
            ) {

              label =
                'Running';

              timeInfo +=
                ` · ${this.fmtDur(
                  b.endTime - now
                )} left`;

              actionHtml =
                `<button class="btn-done" data-action="mark-done" data-machine="${b.machineId}">Done Early</button>`;
            }


            return `
              <div class="booking-row">

                <div class="info">

                  <div class="label">
                    ${label}
                  </div>

                  <div class="machine-label">
                    ${m.name}
                  </div>

                  <div class="time">
                    ${timeInfo}
                  </div>

                </div>

                <div class="actions">
                  ${actionHtml}
                </div>

              </div>
            `;
          }
        )
        .join('');
  },


  // =========================================================
  // AWAITING BANNER
  // =========================================================

  updateAwaitingBanner() {

    const banner =
      document.getElementById(
        'awaiting-banner'
      );


    if (!banner) {
      return;
    }


    const a =
      this.awaitingBooking();


    if (!a) {

      banner.classList.add(
        'hidden'
      );

      return;
    }


    banner.classList.remove(
      'hidden'
    );


    const m =
      this.machines.find(
        x =>
          x.id ===
          a.machineId
      );


    if (!m) {
      return;
    }


    const now =
      this.now();


    const detail =
      document.getElementById(
        'awaiting-detail'
      );


    if (detail) {

      detail.textContent =
        `${m.name} · ${this.fmtSlot(
          a.startTime,
          a.endTime
        )} · starts in ${this.fmtDur(
          a.startTime - now
        )}`;
    }
  },


  // =========================================================
  // MACHINE DETAIL
  // =========================================================

  renderMachineDetail() {

    const m =
      this.machines.find(
        x =>
          x.id ===
          this.state.selectedMachine
      );


    if (!m) {

      this.showView(
        'dashboard'
      );

      return;
    }


    const machineName =
      document.getElementById(
        'machine-name'
      );


    if (machineName) {

      machineName.textContent =
        m.name;
    }


    const status =
      this.getMachineStatus(
        m.id
      );


    let line = '';


    if (
      status.status ===
      'free'
    ) {

      line =
        'Available now · Tap any slot to book';

    }


    else if (
      status.status ===
      'running'
    ) {

      line =
        `Running for ${this.userDisplay(
          status.booking
        )} · ends in ${this.fmtDur(
          status.booking.endTime -
          this.now()
        )}`;

    }


    else if (
      status.status ===
      'awaiting_confirmation'
    ) {

      line =
        `Awaiting ${this.userDisplay(
          status.booking
        )} · starts in ${this.fmtDur(
          status.booking.startTime -
          this.now()
        )}`;

    }


    else {

      line =
        `Booked by ${this.userDisplay(
          status.booking
        )} · starts in ${this.fmtDur(
          status.booking.startTime -
          this.now()
        )}`;
    }


    const statusLine =
      document.getElementById(
        'machine-status-line'
      );


    if (statusLine) {

      statusLine.textContent =
        line;
    }


    const hero =
      document.getElementById(
        'machine-hero'
      );


    if (hero) {

      hero.innerHTML = `

        <div class="porthole lg ${status.status}">

          <div class="drum"></div>

          <div class="water"></div>

        </div>


        <div class="info">

          <div class="machine-letter">
            MACHINE ${m.code}
          </div>

          <div
            class="machine-name"
            style="font-size: 22px; margin-bottom: 6px"
          >
            ${m.name}
          </div>

          <div
            class="machine-status-row ${status.status}"
          >

            <span class="dot"></span>

            ${status.status
              .replace('_', ' ')
              .toUpperCase()}

          </div>

          <div
            class="machine-meta"
            style="margin-top: 6px"
          >
            ${line}
          </div>

        </div>
      `;
    }


    this.renderSlotGrid(
      'slot-grid-today',
      m.id,
      0
    );


    this.renderSlotGrid(
      'slot-grid-tomorrow',
      m.id,
      1
    );
  },


  // =========================================================
  // UPDATE SLOT GRID
  // =========================================================

  updateSlotGrid() {

    if (
      this.state.currentView !==
      'machine-detail'
    ) {

      return;
    }


    const m =
      this.machines.find(
        x =>
          x.id ===
          this.state.selectedMachine
      );


    if (!m) {
      return;
    }


    this.renderSlotGrid(
      'slot-grid-today',
      m.id,
      0
    );


    this.renderSlotGrid(
      'slot-grid-tomorrow',
      m.id,
      1
    );
  },


  // =========================================================
  // SLOT GRID
  // =========================================================

  renderSlotGrid(
    elementId,
    machineId,
    dayOffset
  ) {

    const container =
      document.getElementById(
        elementId
      );


    if (!container) {
      return;
    }


    const now =
      this.now();


    const baseDate =
      new Date(now);


    baseDate.setHours(
      0,
      0,
      0,
      0
    );


    baseDate.setDate(
      baseDate.getDate() +
      dayOffset
    );


    let html = '';


    for (
      let hour = 0;
      hour < 24;
      hour++
    ) {

      const slotStart =
        new Date(
          baseDate
        );


      slotStart.setHours(
        hour,
        0,
        0,
        0
      );


      const slotEnd =
        new Date(
          slotStart.getTime() +
          this.SLOT_MS
        );


      const startMs =
        slotStart.getTime();


      /*
       * IMPORTANT:
       * Search ALL bookings.
       */

      const taken =
        this.state.bookings.find(
          b =>

            b.machineId ===
              machineId &&

            b.startTime ===
              startMs &&

            [
              'booked',
              'awaiting_confirmation',
              'confirmed',
              'running'
            ].includes(b.status)
        );


      const isPast =
        slotEnd <= now;


      const isCurrent =
        slotStart <= now &&
        now < slotEnd;


      const isMine =
        taken &&
        this.state.user &&
        taken.userId ===
          this.state.user.uid;


      let cls =
        'slot free';


      let sub = '';

      let disabled = '';


      // -----------------------------------------------------
      // PAST
      // -----------------------------------------------------

      if (
        isPast &&
        !taken
      ) {

        cls =
          'slot past';

        sub =
          'past';

        disabled =
          'disabled';
      }


      // -----------------------------------------------------
      // CURRENT
      // -----------------------------------------------------

      else if (
        isCurrent &&
        !taken
      ) {

        cls =
          'slot free';

        sub =
          'now';
      }


      // -----------------------------------------------------
      // TAKEN
      // -----------------------------------------------------

      else if (taken) {


        if (isMine) {

          cls =
            'slot mine';

          sub =
            'you';

          disabled =
            'disabled';

        }


        else {

          if (
            taken.status ===
            'running'
          ) {

            cls =
              'slot running';

            sub =
              'running';

          }

          else {

            cls =
              'slot taken';

            sub =
              'taken';
          }


          disabled =
            'disabled';
        }
      }


      // -----------------------------------------------------
      // SOON
      // -----------------------------------------------------

      else if (
        startMs - now <
          30 * 60 * 1000 &&
        startMs > now
      ) {

        sub =
          'soon';
      }


      html += `

        <button
          class="${cls}"
          ${disabled}
          data-start="${startMs}"
          data-machine="${machineId}"
        >

          <span class="time">
            ${this.fmtHour(
              slotStart
            )}
          </span>

          <span class="sub">
            ${sub}
          </span>

        </button>
      `;
    }


    container.innerHTML =
      html;
  },


  // =========================================================
  // FORMATTERS
  // =========================================================

  fmtHour(date) {

    const h =
      date.getHours();


    const ampm =
      h >= 12
        ? 'PM'
        : 'AM';


    return (
      `${h % 12 || 12} ${ampm}`
    );
  },


  fmtTime(date) {

    const h =
      date.getHours();


    const m =
      String(
        date.getMinutes()
      ).padStart(
        2,
        '0'
      );


    const ampm =
      h >= 12
        ? 'PM'
        : 'AM';


    return (
      `${h % 12 || 12}:${m} ${ampm}`
    );
  },


  fmtSlot(
    start,
    end
  ) {

    return (
      `${this.fmtHour(
        new Date(start)
      )} – ${this.fmtHour(
        new Date(end)
      )}`
    );
  },


  fmtSlotFull(ms) {

    const d =
      new Date(ms);


    const day =
      d.toLocaleDateString(
        'en-IN',
        {
          weekday: 'short',
          day: 'numeric',
          month: 'short'
        }
      );


    return (
      `${day}, ${this.fmtTime(d)}`
    );
  },


  fmtDur(ms) {

    if (ms <= 0) {
      return '0m';
    }


    const totalMin =
      Math.floor(
        ms / 60000
      );


    const h =
      Math.floor(
        totalMin / 60
      );


    const m =
      totalMin % 60;


    return h > 0
      ? `${h}h ${m}m`
      : `${m}m`;
  },


  // =========================================================
  // USER DISPLAY
  // =========================================================

  userDisplay(b) {

    if (!b) {
      return '—';
    }


    if (
      this.state.user &&
      b.userId ===
        this.state.user.uid
    ) {

      return 'You';
    }


    return (
      b.username ||
      'Someone'
    );
  },


  // =========================================================
  // TOAST
  // =========================================================

  toast(msg) {

    const t =
      document.getElementById(
        'toast'
      );


    if (!t) {
      return;
    }


    t.textContent =
      msg;


    t.classList.remove(
      'hidden'
    );


    clearTimeout(
      this._toastTimer
    );


    this._toastTimer =
      setTimeout(
        () => {

          t.classList.add(
            'hidden'
          );

        },
        2500
      );
  }

};


// ============================================================
// START APP
// ============================================================

document.addEventListener(
  'DOMContentLoaded',
  () => {

    APP.init();

  }
);