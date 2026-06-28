(function(){
	const toggle = document.getElementById('toggle-sidebar');
	const layout = document.querySelector('.dashboard-layout');
	const backdrop = document.getElementById('sidebar-backdrop');
	if(!toggle || !layout) return;

	function setOpen(open){
		layout.classList.toggle('sidebar-open', open);
		toggle.setAttribute('aria-expanded', String(open));
		if(backdrop) backdrop.setAttribute('aria-hidden', String(!open));
	}

	toggle.addEventListener('click', function(){
		setOpen(!layout.classList.contains('sidebar-open'));
	});

	if(backdrop){
		backdrop.addEventListener('click', function(){ setOpen(false); });
	}

	// Close with ESC
	document.addEventListener('keydown', function(e){
		if(e.key === 'Escape' && layout.classList.contains('sidebar-open')) setOpen(false);
	});
})();