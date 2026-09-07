/* ============================================================
   WASHIFY — FINAL FIREBASE + REAL-TIME VERSION

   Features:
   - Google OAuth
   - Permanent username + phone stored in Firestore
   - Firestore bookings
   - GLOBAL real-time booking visibility
   - Users can only manage their own bookings
   - One active booking per user
   - Machine availability visible to everyone
   - 15-minute confirmation
   - 5-minute confirmation window
   - 1-hour machine cycle
   - True 1-hour consecutive slot grid
   - Overlap protection
   - Taken-slot contact details
   - 5-minute pre-completion in-app reminder
   - Booking success animation
   - Cross-device synchronization
   ============================================================ */


const firebaseConfig = {
  apiKey: "AIzaSyDQj1VsF1M2LUZtbPamdO7wjWLVJueFb1c",
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

    bookings: [],

    currentView: 'login',
    selectedMachine: null,

    isOnlineListener: false,
    isLoadingBookings: false,

    bookingUnsubscribe: null,

    selectedBooking: null,

    reminderDismissedBookingId: null
  },


  // =========================================================
  // MACHINES
  // =========================================================

  machines: [
    {
      id: 'a',
      code: 'A',
      name: 'Washy 1'
    },
    {
      id: 'b',
      code: 'B',
      name: 'Washy 2'
    },
    {
      id: 'c',
      code: 'C',
      name: 'Washy 3'
    }
  ],


  // =========================================================
  // TIME SETTINGS
  // =========================================================

  // Every normal slot/cycle = 1 hour
  SLOT_MS: 60 * 60 * 1000,

  // Ask for confirmation 15 minutes before start
  CONFIRM_LEAD_MS: 15 * 60 * 1000,

  // Confirmation must happen within final 5 minutes
  CONFIRM_WINDOW_MS: 5 * 60 * 1000,

  // Reminder starts 5 minutes before completion
  COMPLETION_REMINDER_MS: 5 * 60 * 1000,


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


        /*
         * Existing users without a phone number must
         * complete the profile again so their contact
         * number can be stored.
         */
        if (
          this.state.profile &&
          this.state.profile.username &&
          this.state.profile.phone
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
        this.state.selectedBooking = null;
        this.state.reminderDismissedBookingId = null;

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

      console.error(
        'Profile load failed:',
        e
      );

      this.state.profile = null;
    }
  },


  async saveUsername(username, phone) {

    if (!this.state.user) {
      throw new Error('Not authenticated');
    }


    const uid = this.state.user.uid;

    const payload = {
      username: username,
      email: this.state.user.email || '',
      phone: phone
    };


    /*
     * Do not overwrite the original createdAt
     * every time an existing profile is edited.
     */
    if (
      !this.state.profile ||
      !this.state.profile.createdAt
    ) {

      payload.createdAt =
        firebase.firestore.FieldValue.serverTimestamp();
    }


    await db
      .collection('users')
      .doc(uid)
      .set(payload, {
        merge: true
      });


    this.state.profile = {
      ...(this.state.profile || {}),
      ...payload
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
          this.timestampValue(b.createdAt) -
          this.timestampValue(a.createdAt)
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

        userId:
          this.state.user.uid,

        userEmail:
          this.state.user.email || '',

        username:
          this.state.profile
            ? this.state.profile.username
            : 'User',

        userPhone:
          this.state.profile
            ? this.state.profile.phone || ''
            : ''
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
        // PREVIOUS USER MODAL CLOSE
        // -----------------------------------------------------

        if (
          t.closest('#previous-user-close')
        ) {

          this.closePreviousUserModal();

          return;
        }


        // -----------------------------------------------------
        // PREVIOUS USER MODAL BACKDROP
        // -----------------------------------------------------

        if (
          t.id === 'previous-user-modal'
        ) {

          this.closePreviousUserModal();

          return;
        }


        // -----------------------------------------------------
        // CALL BOOKING USER
        // -----------------------------------------------------

        const callBtn =
          t.closest('#previous-user-call');

        if (callBtn) {

          const bookingId =
            this.state.selectedBooking
              ? this.state.selectedBooking.id
              : null;

          if (bookingId) {

            const booking =
              this.state.bookings.find(
                b => b.id === bookingId
              );

            if (booking) {
              this.callBookingUser(booking);
            }
          }

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
          t.closest('.slot');

        if (slot) {

          const start =
            Number(slot.dataset.start);

          const end =
            Number(slot.dataset.end);

          const machineId =
            slot.dataset.machine;


          /*
           * Past slots cannot be opened.
           */
          if (
            slot.classList.contains('past')
          ) {
            return;
          }


          /*
           * Find any active booking overlapping
           * this exact slot.
           */
          const booking =
            this.findOverlappingBooking(
              machineId,
              start,
              end
            );


          /*
           * TAKEN / RUNNING / OTHER USER:
           * Open contact details.
           */
          if (booking) {

            this.openPreviousUserModal(
              booking
            );

            return;
          }


          /*
           * Own slot with no active booking
           * should not normally occur, but keep
           * it safe.
           */
          if (
            slot.classList.contains('mine')
          ) {
            return;
          }


          /*
           * FREE SLOT
           */
          if (
            slot.classList.contains('free')
          ) {

            this.bookSlot(
              machineId,
              start,
              end
            );

            return;
          }
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


        if (
          t.id === 'booking-success'
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


        // -----------------------------------------------------
        // COMPLETION REMINDER DISMISS
        // -----------------------------------------------------

        if (
          t.closest('#cycle-reminder-dismiss')
        ) {

          const current =
            this.getRunningUserBooking();

          if (current) {

            this.state.reminderDismissedBookingId =
              current.id;
          }

          const banner =
            document.getElementById(
              'cycle-reminder-banner'
            );

          if (banner) {
            banner.classList.add('hidden');
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


  // =========================================================
  // SAVE USERNAME + PHONE
  // =========================================================

  async handleSaveUsername() {

    const input =
      document.getElementById(
        'new-username'
      );

    const phoneInput =
      document.getElementById(
        'new-phone'
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

    const phone =
      phoneInput
        ? phoneInput.value.trim()
        : '';


    // Username must be: 204 Arjun
    if (!/^\d+\s+\S+/.test(username)) {

      if (errorEl) {

        errorEl.textContent =
          'Use format: [Room No] Name (e.g., 204 Arjun)';
      }

      return;
    }


    // Phone must be exactly 10 digits
    if (!/^\d{10}$/.test(phone)) {

      if (errorEl) {

        errorEl.textContent =
          'Enter a valid 10-digit contact number';
      }

      return;
    }


    try {

      await this.saveUsername(
        username,
        phone
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
        'Profile save failed:',
        e
      );

      if (errorEl) {

        errorEl.textContent =
          'Failed to save: ' +
          e.message;
      }
    }
  },


  // =========================================================
  // LOGOUT
  // =========================================================

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
    this.state.selectedBooking = null;

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


            this.state.bookings =
              all.sort(
                (a, b) =>
                  this.timestampValue(b.createdAt) -
                  this.timestampValue(a.createdAt)
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


    const usernameInput =
      document.getElementById(
        'new-username'
      );

    if (
      usernameInput &&
      this.state.profile &&
      this.state.profile.username
    ) {

      usernameInput.value =
        this.state.profile.username;
    }


    const phoneInput =
      document.getElementById(
        'new-phone'
      );

    if (
      phoneInput &&
      this.state.profile &&
      this.state.profile.phone
    ) {

      phoneInput.value =
        this.state.profile.phone;
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

    this.updateCompletionReminder();


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
        now < b.startTime
      ) {

        b.status =
          'awaiting_confirmation';

        b.confirmationDeadline =
          b.startTime -
          this.CONFIRM_WINDOW_MS;


        if (
          this.state.user &&
          b.userId ===
            this.state.user.uid
        ) {

          this.persistStatus(
            b.id,
            'awaiting_confirmation',
            {
              confirmationDeadline:
                b.confirmationDeadline
            }
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
    status,
    extraData = {}
  ) {

    try {

      await db
        .collection('bookings')
        .doc(id)
        .update({

          status: status,

          ...extraData
        });

    } catch (e) {

      console.warn(
        'Status sync failed:',
        e
      );
    }
  },


  // =========================================================
  // BOOKING QUERIES
  // =========================================================

  isActiveBooking(b) {

    return !!b &&
      [
        'booked',
        'awaiting_confirmation',
        'confirmed',
        'running'
      ].includes(b.status);
  },


  findOverlappingBooking(
    machineId,
    startTime,
    endTime
  ) {

    return this.state.bookings.find(
      b =>

        b.machineId === machineId &&

        this.isActiveBooking(b) &&

        Number(b.startTime) < endTime &&

        Number(b.endTime) > startTime
    ) || null;
  },


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


  userActiveBookings() {

    if (!this.state.user) {
      return [];
    }


    return this.state.bookings.filter(
      b =>
        b.userId ===
          this.state.user.uid &&

        this.isActiveBooking(b)
    );
  },


  getRunningUserBooking() {

    if (!this.state.user) {
      return null;
    }


    return this.state.bookings.find(
      b =>
        b.userId ===
          this.state.user.uid &&

        b.status ===
          'running' &&

        b.endTime > this.now()
    ) || null;
  },


  // =========================================================
  // GLOBAL MACHINE STATUS
  // =========================================================

  getMachineStatus(machineId) {

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
            !this.isActiveBooking(b)
          ) {

            return false;
          }


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
    startTime,
    slotEndTime = null
  ) {


    if (
      this.userActiveBookings().length > 0
    ) {

      this.toast(
        'You already have an active booking · cancel it first'
      );

      return;
    }


    /*
     * Use the actual generated slot end.
     * This matters for a shorter final slot.
     */
    const endTime =
      slotEndTime ||
      (
        startTime +
        this.SLOT_MS
      );


    /*
     * Prevent overlapping bookings,
     * not just identical start times.
     */
    const taken =
      this.findOverlappingBooking(
        machineId,
        startTime,
        endTime
      );


    if (taken) {

      this.toast(
        'That slot was just taken · pick another'
      );

      return;
    }


    /*
     * Don't allow booking a slot that has already started.
     */
    if (
      startTime < this.now()
    ) {

      this.toast(
        'That slot has already started'
      );

      return;
    }


    const booking = {

      id:
        'bk_' +
        Date.now() +
        '_' +
        Math.random()
          .toString(36)
          .slice(2, 6),

      machineId: machineId,

      startTime: startTime,

      endTime: endTime,

      status: 'booked',

      confirmationDeadline: null,

      createdAt: this.now(),

      token:
        'T-' +
        (
          Math.floor(
            Math.random() * 90
          ) + 10
        )
    };


    /*
     * Optimistic local booking.
     */
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
            : 'User',

        userPhone:
          this.state.profile
            ? this.state.profile.phone || ''
            : ''
      }
    );


    this.render();


    this.showBookingSuccess(
      booking,
      'booked'
    );


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


    if (
      this.userActiveBookings().length > 0
    ) {

      this.toast(
        'You already have an active booking'
      );

      return;
    }


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

    const end =
      start +
      this.SLOT_MS;


    const booking = {

      id:
        'bk_' +
        Date.now() +
        '_' +
        Math.random()
          .toString(36)
          .slice(2, 6),

      machineId: machineId,

      startTime: start,

      endTime: end,

      status: 'running',

      confirmationDeadline: null,

      createdAt: start,

      token:
        'T-' +
        (
          Math.floor(
            Math.random() * 90
          ) + 10
        )
    };


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
            : 'User',

        userPhone:
          this.state.profile
            ? this.state.profile.phone || ''
            : ''
      }
    );


    this.render();


    this.showBookingSuccess(
      booking,
      'running'
    );


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


    /*
     * Don't confirm after the deadline.
     */
    if (
      this.now() >=
      b.confirmationDeadline
    ) {

      b.status = 'expired';

      this.render();

      this.toast(
        'Confirmation window expired'
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
  // PREVIOUS USER / TAKEN SLOT MODAL
  // =========================================================

  openPreviousUserModal(booking) {

    if (!booking) {
      return;
    }


    /*
     * Own booking details are not shown
     * in the taken-user popup.
     */
    if (
      this.state.user &&
      booking.userId ===
        this.state.user.uid
    ) {

      return;
    }


    this.state.selectedBooking =
      booking;


    const modal =
      document.getElementById(
        'previous-user-modal'
      );

    if (!modal) {
      return;
    }


    const nameEl =
      document.getElementById(
        'previous-user-name'
      );

    const roomEl =
      document.getElementById(
        'previous-user-room'
      );

    const contactEl =
      document.getElementById(
        'previous-user-contact'
      );

    const callBtn =
      document.getElementById(
        'previous-user-call'
      );


    const username =
      booking.username ||
      'Unknown user';


    const room =
      this.extractRoomNumber(
        username
      );


    const name =
      this.extractPersonName(
        username
      );


    const phone =
      booking.userPhone ||
      booking.phone ||
      booking.contact ||
      '';


    if (nameEl) {

      nameEl.textContent =
        name || 'Unknown user';
    }


    if (roomEl) {

      roomEl.textContent =
        room || 'Not provided';
    }


    if (contactEl) {

      contactEl.textContent =
        phone || 'Not available';
    }


    if (callBtn) {

      if (phone) {

        callBtn.classList.remove(
          'hidden'
        );

        callBtn.disabled = false;

      } else {

        callBtn.classList.add(
          'hidden'
        );
      }
    }


    modal.classList.remove(
      'hidden'
    );
  },


  closePreviousUserModal() {

    const modal =
      document.getElementById(
        'previous-user-modal'
      );

    if (modal) {

      modal.classList.add(
        'hidden'
      );
    }


    this.state.selectedBooking =
      null;
  },


  // =========================================================
  // ROOM / NAME / PHONE HELPERS
  // =========================================================

  extractRoomNumber(username) {

    if (!username) {
      return '';
    }


    const match =
      String(username).match(
        /^\s*(\d+)\s+/
      );


    return match
      ? match[1]
      : '';
  },


  extractPersonName(username) {

    if (!username) {
      return 'Unknown user';
    }


    const text =
      String(username).trim();


    const match =
      text.match(
        /^\d+\s+(.+)$/
      );


    if (match) {
      return match[1].trim();
    }


    return text || 'Unknown user';
  },


  extractPhone(value) {

    if (!value) {
      return '';
    }


    const phone =
      String(value)
        .replace(
          /[^\d+]/g,
          ''
        );


    /*
     * Indian 10-digit phone numbers.
     * Also accepts +91XXXXXXXXXX if present.
     */
    if (
      /^\d{10}$/.test(phone)
    ) {

      return phone;
    }


    if (
      /^\+91\d{10}$/.test(phone)
    ) {

      return phone;
    }


    return '';
  },


  callBookingUser(booking) {

    if (!booking) {
      return;
    }


    const contact =
      booking.userPhone ||
      booking.phone ||
      booking.contact ||
      '';


    const phone =
      this.extractPhone(
        contact
      );


    if (!phone) {

      this.toast(
        'Phone number unavailable'
      );

      return;
    }


    window.location.href =
      `tel:${phone}`;
  },


  // =========================================================
  // COMPLETION REMINDER
  // =========================================================

  updateCompletionReminder() {

    /*
     * This matches the HTML supplied for V1:
     *
     * #cycle-reminder-banner
     * #cycle-reminder-detail
     * #cycle-reminder-dismiss
     */
    const banner =
      document.getElementById(
        'cycle-reminder-banner'
      );


    if (!banner) {
      return;
    }


    if (!this.state.user) {

      banner.classList.add(
        'hidden'
      );

      return;
    }


    const now =
      this.now();


    /*
     * Find current user's running booking.
     */
    const booking =
      this.getRunningUserBooking();


    if (!booking) {

      banner.classList.add(
        'hidden'
      );

      return;
    }


    const remaining =
      booking.endTime -
      now;


    /*
     * Reminder begins exactly 5 minutes
     * before completion and stops at completion.
     */
    if (
      remaining <= 0 ||
      remaining >
        this.COMPLETION_REMINDER_MS
    ) {

      banner.classList.add(
        'hidden'
      );

      return;
    }


    /*
     * Don't immediately bring the banner
     * back after the user dismisses it.
     */
    if (
      this.state.reminderDismissedBookingId ===
      booking.id
    ) {

      banner.classList.add(
        'hidden'
      );

      return;
    }


    const machine =
      this.machines.find(
        m =>
          m.id ===
          booking.machineId
      );


    const detail =
      document.getElementById(
        'cycle-reminder-detail'
      );


    if (detail) {

      detail.textContent =
        `${machine ? machine.name : 'Machine'} · finishes in ${this.fmtDur(remaining)}`;
    }


    banner.classList.remove(
      'hidden'
    );
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
          `Running for ${this.fmtDurationLong(
            booking.endTime -
            booking.startTime
          )} · ends at ${this.fmtTime(endDate)} · others see the machine as occupied`;

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

    this.updateAwaitingBanner();

    this.updateCompletionReminder();
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
        `<strong>${this.escapeHtml(
          this.state.profile.username
        )}</strong>`;
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
                    ${this.escapeHtml(m.name)}
                  </div>

                </div>

              </div>
            `;
          }
        )
        .join('');


    this.renderMyBookings();

    this.updateAwaitingBanner();

    this.updateCompletionReminder();
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
                    ${this.escapeHtml(m.name)}
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
        `Running · ends in ${this.fmtDur(
          status.booking.endTime -
          this.now()
        )}`;

    }


    else if (
      status.status ===
      'awaiting_confirmation'
    ) {

      line =
        `Awaiting confirmation · starts in ${this.fmtDur(
          status.booking.startTime -
          this.now()
        )}`;

    }


    else {

      line =
        `Booked · starts in ${this.fmtDur(
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
            ${this.escapeHtml(m.name)}
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
  // TRUE 1-HOUR SLOT GENERATION
  // =========================================================

  getDaySlots(date) {

    const dayStart =
      new Date(date);


    dayStart.setHours(
      0,
      0,
      0,
      0
    );


    const dayEnd =
      new Date(dayStart);


    dayEnd.setDate(
      dayEnd.getDate() + 1
    );


    const slots = [];


    let start =
      dayStart.getTime();


    while (
      start <
      dayEnd.getTime()
    ) {

      const end =
        Math.min(
          start +
          this.SLOT_MS,

          dayEnd.getTime()
        );


      slots.push({
        startTime: start,
        endTime: end
      });


      start = end;
    }


    return slots;
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


    const slots =
      this.getDaySlots(
        baseDate
      );


    let html = '';


    slots.forEach(
      slot => {

        const startMs =
          slot.startTime;

        const endMs =
          slot.endTime;


        /*
         * Find ANY active booking overlapping
         * this slot.
         */
        const taken =
          this.findOverlappingBooking(
            machineId,
            startMs,
            endMs
          );


        /*
         * A slot is past only when its end
         * has already passed.
         */
        const isPast =
          endMs <= now;


        const isCurrent =
          startMs <= now &&
          now < endMs;


        const isMine =
          taken &&
          this.state.user &&
          taken.userId ===
            this.state.user.uid;


        let cls =
          'slot free';

        let sub =
          this.slotDurationLabel(
            startMs,
            endMs
          );

        let disabled = '';

        let bookingId = '';


        // -----------------------------------------------------
        // ACTIVE BOOKING
        // -----------------------------------------------------

        if (taken) {

          bookingId =
            taken.id;


          if (isMine) {

            /*
             * Your own active slot.
             * It remains visible but cannot be booked again.
             */
            cls =
              'slot mine';

            sub =
              'YOUR SLOT';

            /*
             * Keep it disabled because the user
             * does not need to open their own contact info.
             */
            disabled =
              'disabled';

          }


          else if (
            taken.status ===
            'running'
          ) {

            /*
             * Running slots remain clickable
             * so other users can view contact details.
             */
            cls =
              'slot running';

            sub =
              'RUNNING';

            disabled = '';

          }


          else {

            /*
             * Other user's booked slot.
             * IMPORTANT: clickable.
             */
            cls =
              'slot taken';

            sub =
              'TAKEN';

            disabled = '';
          }
        }


        // -----------------------------------------------------
        // PAST FREE SLOT
        // -----------------------------------------------------

        else if (isPast) {

          cls =
            'slot past';

          sub =
            'PAST';

          disabled =
            'disabled';
        }


        // -----------------------------------------------------
        // CURRENT FREE SLOT
        // -----------------------------------------------------

        else if (isCurrent) {

          cls =
            'slot free';

          sub =
            'NOW';
        }


        // -----------------------------------------------------
        // UPCOMING SLOT
        // -----------------------------------------------------

        else {

          /*
           * Keep normal duration label.
           * If the final slot is shorter than 1 hour,
           * the actual duration is shown automatically.
           */
          sub =
            this.slotDurationLabel(
              startMs,
              endMs
            );


          /*
           * Optional "soon" state for slots
           * starting within 30 minutes.
           */
          if (
            startMs - now <
              30 * 60 * 1000
          ) {

            sub =
              'SOON';
          }
        }


        html += `

          <button
            class="${cls}"
            ${disabled}

            data-start="${startMs}"

            data-end="${endMs}"

            data-machine="${machineId}"

            ${
              bookingId
                ? `data-booking-id="${bookingId}"`
                : ''
            }
          >

            <span class="time">
              ${this.fmtSlot(
                startMs,
                endMs
              )}
            </span>

            <span class="sub">
              ${sub}
            </span>

          </button>
        `;
      }
    );


    container.innerHTML =
      html;
  },


  // =========================================================
  // SLOT DURATION LABEL
  // =========================================================

  slotDurationLabel(
    start,
    end
  ) {

    const minutes =
      Math.round(
        (
          end -
          start
        ) / 60000
      );


    if (
      minutes === 60
    ) {

      return '1 HR';
    }


    if (
      minutes % 60 === 0
    ) {

      return `${minutes / 60} HR`;
    }


    return `${minutes} MIN`;
  },


  // =========================================================
  // FORMATTERS
  // =========================================================

  fmtHour(dateOrMs) {

    const date =
      dateOrMs instanceof Date
        ? dateOrMs
        : new Date(dateOrMs);


    const h =
      date.getHours();


    const ampm =
      h >= 12
        ? 'PM'
        : 'AM';


    return (
      `${h % 12 || 12}:` +
      `${String(
        date.getMinutes()
      ).padStart(2, '0')} ` +
      `${ampm}`
    );
  },


  fmtTime(dateOrMs) {

    const date =
      dateOrMs instanceof Date
        ? dateOrMs
        : new Date(dateOrMs);


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
      `${this.fmtTime(start)} – ${this.fmtTime(end)}`
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

    if (
      ms <= 0
    ) {

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
      totalMin %
      60;


    return h > 0
      ? `${h}h ${m}m`
      : `${m}m`;
  },


  fmtDurationLong(ms) {

    if (
      ms <= 0
    ) {

      return '0 minutes';
    }


    const totalMin =
      Math.round(
        ms / 60000
      );


    const h =
      Math.floor(
        totalMin / 60
      );


    const m =
      totalMin %
      60;


    if (
      h > 0 &&
      m > 0
    ) {

      return `${h} hour${h === 1 ? '' : 's'} ${m} minute${m === 1 ? '' : 's'}`;
    }


    if (
      h > 0
    ) {

      return `${h} hour${h === 1 ? '' : 's'}`;
    }


    return `${m} minute${m === 1 ? '' : 's'}`;
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
  // FIRESTORE TIMESTAMP HELPER
  // =========================================================

  timestampValue(value) {

    if (!value) {
      return 0;
    }


    if (
      typeof value ===
      'number'
    ) {

      return value;
    }


    if (
      value.seconds !== undefined
    ) {

      return (
        value.seconds * 1000 +
        Math.floor(
          (value.nanoseconds || 0) /
          1000000
        )
      );
    }


    if (
      typeof value.toMillis ===
      'function'
    ) {

      return value.toMillis();
    }


    return 0;
  },


  // =========================================================
  // BASIC HTML ESCAPING
  // =========================================================

  escapeHtml(value) {

    return String(
      value ?? ''
    )
      .replace(
        /&/g,
        '&amp;'
      )
      .replace(
        /</g,
        '&lt;'
      )
      .replace(
        />/g,
        '&gt;'
      )
      .replace(
        /"/g,
        '&quot;'
      )
      .replace(
        /'/g,
        '&#039;'
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