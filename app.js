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
   - 60-minute machine cycle
   - True 60-minute consecutive slot grid
   - Overlap protection
   - Taken-slot contact details
   - 5-minute pre-completion in-app reminder
   - Booking success animation
   - Cross-device synchronization
   - Night Mode
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
      name: 'WASHY 1'
    },
    {
      id: 'b',
      code: 'B',
      name: 'WASHY 2'
    },
    {
      id: 'c',
      code: 'C',
      name: 'WASHY 3'
    }
  ],


  // =========================================================
  // TIME SETTINGS
  // =========================================================

  // Every normal slot/cycle = 60 minutes
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

    /*
     * Initialize Night Mode before the application
     * starts rendering its views.
     */
    this.initTheme();

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
  // NIGHT MODE
  // =========================================================

  initTheme() {

    let savedTheme = null;

    try {
      savedTheme = localStorage.getItem(
        'washify-theme'
      );
    } catch (e) {
      console.warn(
        'Theme preference could not be loaded:',
        e
      );
    }


    const isNight =
      savedTheme === 'night';


    document.body.classList.toggle(
      'night-mode',
      isNight
    );


    this.updateThemeButtons(
      isNight
    );
  },


  toggleTheme() {

    const isNight =
      !document.body.classList.contains(
        'night-mode'
      );


    document.body.classList.toggle(
      'night-mode',
      isNight
    );


    try {

      localStorage.setItem(
        'washify-theme',
        isNight
          ? 'night'
          : 'day'
      );

    } catch (e) {

      console.warn(
        'Theme preference could not be saved:',
        e
      );
    }


    this.updateThemeButtons(
      isNight
    );
  },


  updateThemeButtons(isNight) {

    document
      .querySelectorAll(
        '#theme-toggle, #theme-toggle-2'
      )
      .forEach(
        button => {

          const icon =
            button.querySelector(
              '.theme-toggle-icon'
            );

          const label =
            button.querySelector(
              '.theme-toggle-label'
            );


          if (isNight) {

            if (icon) {
              icon.textContent = '☀';
            }

            if (label) {
              label.textContent = 'Day';
            }

            button.setAttribute(
              'aria-label',
              'Switch to day mode'
            );

            button.setAttribute(
              'title',
              'Switch to day mode'
            );

          } else {

            if (icon) {
              icon.textContent = '☾';
            }

            if (label) {
              label.textContent = 'Night';
            }

            button.setAttribute(
              'aria-label',
              'Switch to night mode'
            );

            button.setAttribute(
              'title',
              'Switch to night mode'
            );
          }
        }
      );
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
        // NIGHT MODE
        // -----------------------------------------------------

        if (
          t.closest(
            '#theme-toggle, #theme-toggle-2'
          )
        ) {

          e.preventDefault();
          e.stopPropagation();

          this.toggleTheme();

          return;
        }


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