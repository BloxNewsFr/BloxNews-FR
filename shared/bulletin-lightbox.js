(function () {
    function ready(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    ready(function () {
        const root = document.querySelector('.bulletin-container');
        if (!root) return;

        const images = Array.from(root.querySelectorAll('img')).filter((img) => {
            const src = img.getAttribute('src');
            if (!src) return false;
            if (img.closest('a, button')) return false;
            if (img.closest('.social-share, .site-header, .mobile-nav, .auth-section')) return false;
            return true;
        });

        if (!images.length) return;

        const lightbox = document.createElement('div');
        lightbox.className = 'bulletin-image-lightbox';
        lightbox.setAttribute('role', 'dialog');
        lightbox.setAttribute('aria-modal', 'true');
        lightbox.setAttribute('aria-label', 'Image agrandie');
        lightbox.innerHTML = [
            '<div class="bulletin-image-lightbox__panel">',
            '<button class="bulletin-image-lightbox__close" type="button" aria-label="Fermer">&times;</button>',
            '<img class="bulletin-image-lightbox__img" alt="">',
            '</div>'
        ].join('');
        document.body.appendChild(lightbox);

const modalImg = lightbox.querySelector('.bulletin-image-lightbox__img');
        const closeBtn = lightbox.querySelector('.bulletin-image-lightbox__close');
        // AJOUT : On cible le panneau parent
        const panel = lightbox.querySelector('.bulletin-image-lightbox__panel'); 
        let activeSourceImg = null;

        function fitImageToViewport() {
            const sourceWidth = modalImg.naturalWidth || activeSourceImg?.naturalWidth || 1;
            const sourceHeight = modalImg.naturalHeight || activeSourceImg?.naturalHeight || 1;
            const viewportWidth = window.innerWidth * (window.innerWidth <= 640 ? 0.96 : 0.94);
            const viewportHeight = window.innerHeight * (window.innerWidth <= 640 ? 0.86 : 0.9);
            const ratio = sourceWidth / sourceHeight;

            let targetWidth = viewportWidth;
            let targetHeight = targetWidth / ratio;

            if (targetHeight > viewportHeight) {
                targetHeight = viewportHeight;
                targetWidth = targetHeight * ratio;
            }

            // MODIFICATION : On applique les dimensions au panneau, pas à l'image
            panel.style.width = Math.round(targetWidth) + 'px';
            panel.style.height = Math.round(targetHeight) + 'px';
        }

        function openLightbox(img) {
            activeSourceImg = img;
            modalImg.onload = fitImageToViewport;
            modalImg.src = img.currentSrc || img.src;
            modalImg.alt = img.alt || 'Image agrandie';
            if (modalImg.complete) fitImageToViewport();
            lightbox.classList.add('is-active');
            document.body.classList.add('bulletin-lightbox-open');
            closeBtn.focus({ preventScroll: true });
        }

        // ... (openLightbox reste inchangé)

        function closeLightbox() {
            lightbox.classList.remove('is-active');
            document.body.classList.remove('bulletin-lightbox-open');
            window.setTimeout(function () {
                if (!lightbox.classList.contains('is-active')) {
                    modalImg.removeAttribute('src');
                    // MODIFICATION : On retire le style du panneau, pas de l'image
                    panel.removeAttribute('style'); 
                    modalImg.onload = null;
                    activeSourceImg = null;
                }
            }, 250);
        }

        images.forEach((img) => {
            img.setAttribute('data-bulletin-lightbox', '');
            img.setAttribute('tabindex', '0');
            img.setAttribute('role', 'button');
            img.setAttribute('aria-label', (img.alt ? img.alt + ' - ' : '') + 'ouvrir en grand');

            img.addEventListener('click', function () {
                openLightbox(img);
            });

            img.addEventListener('keydown', function (event) {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openLightbox(img);
                }
            });
        });

        closeBtn.addEventListener('click', closeLightbox);
        lightbox.addEventListener('click', function (event) {
            if (event.target === lightbox) closeLightbox();
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && lightbox.classList.contains('is-active')) {
                closeLightbox();
            }
        });
        window.addEventListener('resize', function () {
            if (lightbox.classList.contains('is-active')) fitImageToViewport();
        });
    });
})();
