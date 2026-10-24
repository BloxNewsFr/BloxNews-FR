(function() {
    id = 'tips';
    const tips = [
        "Tu peux cliquer sur une image pour l'agrandir !",
        "Recherche rapidement des articles grâce à l'icône loupe dans le menu.",
        "Change de thème à tout moment avec le bouton Mode Sombre.",
        "Abonne-toi au Discord officiel pour ne manquer aucun leak !",
        "Ajoute ce site comme signet si tu es sur mobile !",
    ];

    const DISPLAY_DURATION = 6000;  // Visible pendant 6 secondes
    const CYCLE_INTERVAL = 30000;   // Apparaît toutes les 30 secondes
    const FIRST_DELAY = 2000;       // Premier affichage 2s après l'arrivée

    let currentTipIndex = 0;
    let toastEl, textEl;
    let cycleInterval, autoHideTimeout;

    // Injection du toast s'il n'est pas déjà présent dans la page
    function buildToast() {
        let el = document.getElementById('astuceToast');
        if (el) return el;

        el = document.createElement('div');
        el.id = 'astuceToast';
        el.className = 'astuce-toast is-hidden';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.innerHTML =
            '<div class="astuce-toast__header">' +
                '<div class="astuce-toast__badge">' +
                    '<span class="material-symbols-outlined astuce-toast__icon">lightbulb</span>' +
                    'Astuces' +
                '</div>' +
                '<button class="astuce-toast__close" type="button" aria-label="Fermer la notification">' +
                    '<span class="material-symbols-outlined">close</span>' +
                '</button>' +
            '</div>' +
            '<p class="astuce-toast__body" id="astuceText"></p>';

        el.querySelector('.astuce-toast__close').addEventListener('click', closeToast);
        document.body.appendChild(el);
        return el;
    }

    function showTip() {
        if (!toastEl || toastEl.classList.contains('is-closed')) return;

        textEl.textContent = tips[currentTipIndex];
        toastEl.classList.remove('is-hidden');

        clearTimeout(autoHideTimeout);
        autoHideTimeout = setTimeout(hideTip, DISPLAY_DURATION);
    }

    function hideTip() {
        if (toastEl) toastEl.classList.add('is-hidden');
    }

    function triggerNextCycle() {
        if (!toastEl || toastEl.classList.contains('is-closed')) return;

        hideTip();
        currentTipIndex = (currentTipIndex + 1) % tips.length;

        setTimeout(showTip, 400);
    }

    function closeToast() {
        if (!toastEl) return;
        toastEl.classList.add('is-hidden', 'is-closed');
        clearTimeout(autoHideTimeout);
        clearInterval(cycleInterval);
    }

    window.closeAstuceToast = closeToast;

    toastEl = buildToast();
    textEl = document.getElementById('astuceText');

    setTimeout(showTip, FIRST_DELAY);
    cycleInterval = setInterval(triggerNextCycle, CYCLE_INTERVAL);
})();
