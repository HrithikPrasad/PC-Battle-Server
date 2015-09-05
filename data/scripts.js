exports.BattleScripts = {
	gen: 6,
	runMove: function (move, pokemon, target, sourceEffect) {
		if (!sourceEffect && toId(move) !== 'struggle') {
			var changedMove = this.runEvent('OverrideDecision', pokemon, target, move);
			if (changedMove && changedMove !== true) {
				move = changedMove;
				target = null;
			}
		}
		move = this.getMove(move);
		if (!target && target !== false) target = this.resolveTarget(pokemon, move);

		this.setActiveMove(move, pokemon, target);

		if (pokemon.moveThisTurn) {
			// THIS IS PURELY A SANITY CHECK
			// DO NOT TAKE ADVANTAGE OF THIS TO PREVENT A POKEMON FROM MOVING;
			// USE this.cancelMove INSTEAD
			this.debug('' + pokemon.id + ' INCONSISTENT STATE, ALREADY MOVED: ' + pokemon.moveThisTurn);
			this.clearActiveMove(true);
			return;
		}
		if (!this.runEvent('BeforeMove', pokemon, target, move)) {
			// Prevent invulnerability from persisting until the turn ends
			pokemon.removeVolatile('twoturnmove');
			// Prevent Pursuit from running again against a slower U-turn/Volt Switch/Parting Shot
			pokemon.moveThisTurn = true;
			this.clearActiveMove(true);
			return;
		}
		if (move.beforeMoveCallback) {
			if (move.beforeMoveCallback.call(this, pokemon, target, move)) {
				this.clearActiveMove(true);
				return;
			}
		}
		pokemon.lastDamage = 0;
		var lockedMove = this.runEvent('LockMove', pokemon);
		if (lockedMove === true) lockedMove = false;
		if (!lockedMove) {
			if (!pokemon.deductPP(move, null, target) && (move.id !== 'struggle')) {
				this.add('cant', pokemon, 'nopp', move);
				this.clearActiveMove(true);
				return;
			}
		} else {
			sourceEffect = this.getEffect('lockedmove');
		}
		pokemon.moveUsed(move);
		this.useMove(move, pokemon, target, sourceEffect);
		this.singleEvent('AfterMove', move, null, pokemon, target, move);
	},
	useMove: function (move, pokemon, target, sourceEffect) {
		if (!sourceEffect && this.effect.id) sourceEffect = this.effect;
		move = this.getMoveCopy(move);
		if (this.activeMove) move.priority = this.activeMove.priority;
		var baseTarget = move.target;
		if (!target && target !== false) target = this.resolveTarget(pokemon, move);
		if (move.target === 'self' || move.target === 'allies') {
			target = pokemon;
		}
		if (sourceEffect) move.sourceEffect = sourceEffect.id;
		var moveResult = false;

		this.setActiveMove(move, pokemon, target);

		this.singleEvent('ModifyMove', move, null, pokemon, target, move, move);
		if (baseTarget !== move.target) {
			// Target changed in ModifyMove, so we must adjust it here
			// Adjust before the next event so the correct target is passed to the
			// event
			target = this.resolveTarget(pokemon, move);
		}
		move = this.runEvent('ModifyMove', pokemon, target, move, move);
		if (baseTarget !== move.target) {
			// Adjust again
			target = this.resolveTarget(pokemon, move);
		}
		if (!move) return false;

		var attrs = '';
		var missed = false;
		if (pokemon.fainted) {
			return false;
		}

		if (move.flags['charge'] && !pokemon.volatiles[move.id]) {
			attrs = '|[still]'; // suppress the default move animation
		}

		var movename = move.name;
		if (move.id === 'hiddenpower') movename = 'Hidden Power';
		if (sourceEffect) attrs += '|[from]' + this.getEffect(sourceEffect);
		this.addMove('move', pokemon, movename, target + attrs);

		if (target === false) {
			this.attrLastMove('[notarget]');
			this.add('-notarget');
			if (move.target === 'normal') pokemon.isStaleCon = 0;
			return true;
		}

		var targets = pokemon.getMoveTargets(move, target);
		var extraPP = 0;
		for (var i = 0; i < targets.length; i++) {
			var ppDrop = this.singleEvent('DeductPP', targets[i].getAbility(), targets[i].abilityData, targets[i], pokemon, move);
			if (ppDrop !== true) {
				extraPP += ppDrop || 0;
			}
		}
		if (extraPP > 0) {
			pokemon.deductPP(move, extraPP);
		}

		if (!this.runEvent('TryMove', pokemon, target, move)) {
			return true;
		}

		if (move.ignoreImmunity === undefined) {
			move.ignoreImmunity = (move.category === 'Status');
		}

		var damage = false;
		if (move.target === 'all' || move.target === 'foeSide' || move.target === 'allySide' || move.target === 'allyTeam') {
			damage = this.tryMoveHit(target, pokemon, move);
			if (damage || damage === 0 || damage === undefined) moveResult = true;
		} else if (move.target === 'allAdjacent' || move.target === 'allAdjacentFoes') {
			if (move.selfdestruct) {
				this.faint(pokemon, pokemon, move);
			}
			if (!targets.length) {
				this.attrLastMove('[notarget]');
				this.add('-notarget');
				return true;
			}
			if (targets.length > 1) move.spreadHit = true;
			damage = 0;
			for (var i = 0; i < targets.length; i++) {
				var hitResult = this.tryMoveHit(targets[i], pokemon, move, true);
				if (hitResult || hitResult === 0 || hitResult === undefined) moveResult = true;
				damage += hitResult || 0;
			}
			if (!pokemon.hp) pokemon.faint();
		} else {
			target = targets[0];
			var lacksTarget = target.fainted;
			if (!lacksTarget) {
				if (move.target === 'adjacentFoe' || move.target === 'adjacentAlly' || move.target === 'normal' || move.target === 'randomNormal') {
					lacksTarget = !this.isAdjacent(target, pokemon);
				}
			}
			if (lacksTarget) {
				this.attrLastMove('[notarget]');
				this.add('-notarget');
				if (move.target === 'normal') pokemon.isStaleCon = 0;
				return true;
			}
			damage = this.tryMoveHit(target, pokemon, move);
			if (damage || damage === 0 || damage === undefined) moveResult = true;
		}
		if (!pokemon.hp) {
			this.faint(pokemon, pokemon, move);
		}

		if (!moveResult) {
			this.singleEvent('MoveFail', move, null, target, pokemon, move);
			return true;
		}

		if (move.selfdestruct) {
			this.faint(pokemon, pokemon, move);
		}

		if (!move.negateSecondary && !(pokemon.hasAbility('sheerforce') && pokemon.volatiles['sheerforce'])) {
			this.singleEvent('AfterMoveSecondarySelf', move, null, pokemon, target, move);
			this.runEvent('AfterMoveSecondarySelf', pokemon, target, move);
		}
		return true;
	},
	tryMoveHit: function (target, pokemon, move, spreadHit) {
		if (move.selfdestruct && spreadHit) pokemon.hp = 0;

		this.setActiveMove(move, pokemon, target);
		var hitResult = true;

		hitResult = this.singleEvent('PrepareHit', move, {}, target, pokemon, move);
		if (!hitResult) {
			if (hitResult === false) this.add('-fail', target);
			return false;
		}
		this.runEvent('PrepareHit', pokemon, target, move);

		if (!this.singleEvent('Try', move, null, pokemon, target, move)) {
			return false;
		}

		if (move.target === 'all' || move.target === 'foeSide' || move.target === 'allySide' || move.target === 'allyTeam') {
			if (move.target === 'all') {
				hitResult = this.runEvent('TryHitField', target, pokemon, move);
			} else {
				hitResult = this.runEvent('TryHitSide', target, pokemon, move);
			}
			if (!hitResult) {
				if (hitResult === false) this.add('-fail', target);
				return true;
			}
			return this.moveHit(target, pokemon, move);
		}

		if (move.ignoreImmunity === undefined) {
			move.ignoreImmunity = (move.category === 'Status');
		}

		if (move.ignoreImmunity !== true && !move.ignoreImmunity[move.type] && !target.runImmunity(move.type, true)) {
			return false;
		}

		hitResult = this.runEvent('TryHit', target, pokemon, move);
		if (!hitResult) {
			if (hitResult === false) this.add('-fail', target);
			return false;
		}

		var boostTable = [1, 4 / 3, 5 / 3, 2, 7 / 3, 8 / 3, 3];

		// calculate true accuracy
		var accuracy = move.accuracy;
		var boosts, boost;
		if (accuracy !== true) {
			if (!move.ignoreAccuracy) {
				boosts = this.runEvent('ModifyBoost', pokemon, null, null, Object.clone(pokemon.boosts));
				boost = this.clampIntRange(boosts['accuracy'], -6, 6);
				if (boost > 0) {
					accuracy *= boostTable[boost];
				} else {
					accuracy /= boostTable[-boost];
				}
			}
			if (!move.ignoreEvasion) {
				boosts = this.runEvent('ModifyBoost', target, null, null, Object.clone(target.boosts));
				boost = this.clampIntRange(boosts['evasion'], -6, 6);
				if (boost > 0) {
					accuracy /= boostTable[boost];
				} else if (boost < 0) {
					accuracy *= boostTable[-boost];
				}
			}
		}
		if (move.ohko) { // bypasses accuracy modifiers
			if (!target.isSemiInvulnerable()) {
				accuracy = 30;
				if (pokemon.level >= target.level) {
					accuracy += (pokemon.level - target.level);
				} else {
					this.add('-immune', target, '[ohko]');
					return false;
				}
			}
		} else {
			accuracy = this.runEvent('ModifyAccuracy', target, pokemon, move, accuracy);
		}
		if (move.alwaysHit) {
			accuracy = true; // bypasses ohko accuracy modifiers
		} else {
			accuracy = this.runEvent('Accuracy', target, pokemon, move, accuracy);
		}
		if (accuracy !== true && this.random(100) >= accuracy) {
			if (!spreadHit) this.attrLastMove('[miss]');
			this.add('-miss', pokemon, target);
			return false;
		}

		if (move.breaksProtect) {
			var broke = false;
			for (var i in {kingsshield:1, protect:1, spikyshield:1}) {
				if (target.removeVolatile(i)) broke = true;
			}
			if (this.gen >= 6 || target.side !== pokemon.side) {
				for (var i in {craftyshield:1, matblock:1, quickguard:1, wideguard:1}) {
					if (target.side.removeSideCondition(i)) broke = true;
				}
			}
			if (broke) {
				if (move.id === 'feint') {
					this.add('-activate', target, 'move: Feint');
				} else {
					this.add('-activate', target, 'move: ' + move.name, '[broken]');
				}
			}
		}

		var totalDamage = 0;
		var damage = 0;
		pokemon.lastDamage = 0;
		if (move.multihit) {
			var hits = move.multihit;
			if (hits.length) {
				// yes, it's hardcoded... meh
				if (hits[0] === 2 && hits[1] === 5) {
					if (this.gen >= 5) {
						hits = [2, 2, 3, 3, 4, 5][this.random(6)];
					} else {
						hits = [2, 2, 2, 3, 3, 3, 4, 5][this.random(8)];
					}
				} else {
					hits = this.random(hits[0], hits[1] + 1);
				}
			}
			hits = Math.floor(hits);
			var nullDamage = true;
			var moveDamage;
			// There is no need to recursively check the ´sleepUsable´ flag as Sleep Talk can only be used while asleep.
			var isSleepUsable = move.sleepUsable || this.getMove(move.sourceEffect).sleepUsable;
			var i;
			for (i = 0; i < hits && target.hp && pokemon.hp; i++) {
				if (pokemon.status === 'slp' && !isSleepUsable) break;

				moveDamage = this.moveHit(target, pokemon, move);
				if (moveDamage === false) break;
				if (nullDamage && (moveDamage || moveDamage === 0)) nullDamage = false;
				// Damage from each hit is individually counted for the
				// purposes of Counter, Metal Burst, and Mirror Coat.
				damage = (moveDamage || 0);
				// Total damage dealt is accumulated for the purposes of recoil (Parental Bond).
				totalDamage += damage;
				this.eachEvent('Update');
			}
			if (i === 0) return true;
			if (nullDamage) damage = false;
			this.add('-hitcount', target, i);
		} else {
			damage = this.moveHit(target, pokemon, move);
			totalDamage = damage;
		}

		if (move.recoil) {
			this.damage(this.clampIntRange(Math.round(totalDamage * move.recoil[0] / move.recoil[1]), 1), pokemon, target, 'recoil');
		}

		if (target && pokemon !== target) target.gotAttacked(move, damage, pokemon);

		if (move.ohko) this.add('-ohko');

		if (!damage && damage !== 0) return damage;

		if (target && !move.negateSecondary && !(pokemon.hasAbility('sheerforce') && pokemon.volatiles['sheerforce'])) {
			this.singleEvent('AfterMoveSecondary', move, null, target, pokemon, move);
			this.runEvent('AfterMoveSecondary', target, pokemon, move);
		}

		return damage;
	},
	moveHit: function (target, pokemon, move, moveData, isSecondary, isSelf) {
		var damage;
		move = this.getMoveCopy(move);

		if (!moveData) moveData = move;
		if (!moveData.flags) moveData.flags = {};
		var hitResult = true;

		// TryHit events:
		//   STEP 1: we see if the move will succeed at all:
		//   - TryHit, TryHitSide, or TryHitField are run on the move,
		//     depending on move target (these events happen in useMove
		//     or tryMoveHit, not below)
		//   == primary hit line ==
		//   Everything after this only happens on the primary hit (not on
		//   secondary or self-hits)
		//   STEP 2: we see if anything blocks the move from hitting:
		//   - TryFieldHit is run on the target
		//   STEP 3: we see if anything blocks the move from hitting the target:
		//   - If the move's target is a pokemon, TryHit is run on that pokemon

		// Note:
		//   If the move target is `foeSide`:
		//     event target = pokemon 0 on the target side
		//   If the move target is `allySide` or `all`:
		//     event target = the move user
		//
		//   This is because events can't accept actual sides or fields as
		//   targets. Choosing these event targets ensures that the correct
		//   side or field is hit.
		//
		//   It is the `TryHitField` event handler's responsibility to never
		//   use `target`.
		//   It is the `TryFieldHit` event handler's responsibility to read
		//   move.target and react accordingly.
		//   An exception is `TryHitSide` as a single event (but not as a normal
		//   event), which is passed the target side.

		if (move.target === 'all' && !isSelf) {
			hitResult = this.singleEvent('TryHitField', moveData, {}, target, pokemon, move);
		} else if ((move.target === 'foeSide' || move.target === 'allySide') && !isSelf) {
			hitResult = this.singleEvent('TryHitSide', moveData, {}, target.side, pokemon, move);
		} else if (target) {
			hitResult = this.singleEvent('TryHit', moveData, {}, target, pokemon, move);
		}
		if (!hitResult) {
			if (hitResult === false) this.add('-fail', target);
			return false;
		}

		if (target && !isSecondary && !isSelf) {
			if (move.target !== 'all' && move.target !== 'allySide' && move.target !== 'foeSide') {
				hitResult = this.runEvent('TryPrimaryHit', target, pokemon, moveData);
				if (hitResult === 0) {
					// special Substitute flag
					hitResult = true;
					target = null;
				}
			}
		}
		if (target && isSecondary && !moveData.self) {
			hitResult = true;
		}
		if (!hitResult) {
			return false;
		}

		if (target) {
			var didSomething = false;

			damage = this.getDamage(pokemon, target, moveData);

			// getDamage has several possible return values:
			//
			//   a number:
			//     means that much damage is dealt (0 damage still counts as dealing
			//     damage for the purposes of things like Static)
			//   false:
			//     gives error message: "But it failed!" and move ends
			//   null:
			//     the move ends, with no message (usually, a custom fail message
			//     was already output by an event handler)
			//   undefined:
			//     means no damage is dealt and the move continues
			//
			// basically, these values have the same meanings as they do for event
			// handlers.

			if ((damage || damage === 0) && !target.fainted) {
				if (move.noFaint && damage >= target.hp) {
					damage = target.hp - 1;
				}
				damage = this.damage(damage, target, pokemon, move);
				if (!(damage || damage === 0)) {
					this.debug('damage interrupted');
					return false;
				}
				didSomething = true;
			}
			if (damage === false || damage === null) {
				if (damage === false && !isSecondary && !isSelf) {
					this.add('-fail', target);
				}
				this.debug('damage calculation interrupted');
				return false;
			}

			if (moveData.boosts && !target.fainted) {
				hitResult = this.boost(moveData.boosts, target, pokemon, move);
				didSomething = didSomething || hitResult;
			}
			if (moveData.heal && !target.fainted) {
				var d = target.heal((this.gen < 5 ? Math.floor : Math.round)(target.maxhp * moveData.heal[0] / moveData.heal[1]));
				if (!d && d !== 0) {
					this.add('-fail', target);
					this.debug('heal interrupted');
					return false;
				}
				this.add('-heal', target, target.getHealth);
				didSomething = true;
			}
			if (moveData.status) {
				if (!target.status) {
					hitResult = target.setStatus(moveData.status, pokemon, move);
					if (!hitResult && move.status) {
						this.add('-immune', target, '[msg]');
						return false;
					}
					didSomething = didSomething || hitResult;
				} else if (!isSecondary) {
					if (target.status === moveData.status) {
						this.add('-fail', target, target.status);
					} else {
						this.add('-fail', target);
					}
					return false;
				}
			}
			if (moveData.forceStatus) {
				hitResult = target.setStatus(moveData.forceStatus, pokemon, move);
				didSomething = didSomething || hitResult;
			}
			if (moveData.volatileStatus) {
				hitResult = target.addVolatile(moveData.volatileStatus, pokemon, move);
				didSomething = didSomething || hitResult;
			}
			if (moveData.sideCondition) {
				hitResult = target.side.addSideCondition(moveData.sideCondition, pokemon, move);
				didSomething = didSomething || hitResult;
			}
			if (moveData.weather) {
				hitResult = this.setWeather(moveData.weather, pokemon, move);
				didSomething = didSomething || hitResult;
			}
			if (moveData.terrain) {
				hitResult = this.setTerrain(moveData.terrain, pokemon, move);
				didSomething = didSomething || hitResult;
			}
			if (moveData.pseudoWeather) {
				hitResult = this.addPseudoWeather(moveData.pseudoWeather, pokemon, move);
				didSomething = didSomething || hitResult;
			}
			if (moveData.forceSwitch) {
				if (this.canSwitch(target.side)) didSomething = true; // at least defer the fail message to later
			}
			if (moveData.selfSwitch) {
				if (this.canSwitch(pokemon.side)) didSomething = true; // at least defer the fail message to later
			}
			// Hit events
			//   These are like the TryHit events, except we don't need a FieldHit event.
			//   Scroll up for the TryHit event documentation, and just ignore the "Try" part. ;)
			hitResult = null;
			if (move.target === 'all' && !isSelf) {
				if (moveData.onHitField) hitResult = this.singleEvent('HitField', moveData, {}, target, pokemon, move);
			} else if ((move.target === 'foeSide' || move.target === 'allySide') && !isSelf) {
				if (moveData.onHitSide) hitResult = this.singleEvent('HitSide', moveData, {}, target.side, pokemon, move);
			} else {
				if (moveData.onHit) hitResult = this.singleEvent('Hit', moveData, {}, target, pokemon, move);
				if (!isSelf && !isSecondary) {
					this.runEvent('Hit', target, pokemon, move);
				}
				if (moveData.onAfterHit) hitResult = this.singleEvent('AfterHit', moveData, {}, target, pokemon, move);
			}

			if (!hitResult && !didSomething && !moveData.self && !moveData.selfdestruct) {
				if (!isSelf && !isSecondary) {
					if (hitResult === false || didSomething === false) this.add('-fail', target);
				}
				this.debug('move failed because it did nothing');
				return false;
			}
		}
		if (moveData.self) {
			var selfRoll;
			if (!isSecondary && moveData.self.boosts) selfRoll = this.random(100);
			// This is done solely to mimic in-game RNG behaviour. All self drops have a 100% chance of happening but still grab a random number.
			if (typeof moveData.self.chance === 'undefined' || selfRoll < moveData.self.chance) {
				this.moveHit(pokemon, pokemon, move, moveData.self, isSecondary, true);
			}
		}
		if (moveData.secondaries) {
			var secondaryRoll;
			var secondaries = this.runEvent('ModifySecondaries', target, pokemon, moveData, moveData.secondaries.slice());
			for (var i = 0; i < secondaries.length; i++) {
				secondaryRoll = this.random(100);
				if (typeof secondaries[i].chance === 'undefined' || secondaryRoll < secondaries[i].chance) {
					this.moveHit(target, pokemon, move, secondaries[i], true, isSelf);
				}
			}
		}
		if (target && target.hp > 0 && pokemon.hp > 0 && moveData.forceSwitch && this.canSwitch(target.side)) {
			hitResult = this.runEvent('DragOut', target, pokemon, move);
			if (hitResult) {
				target.forceSwitchFlag = true;
			} else if (hitResult === false && move.category === 'Status') {
				this.add('-fail', target);
			}
		}
		if (move.selfSwitch && pokemon.hp) {
			pokemon.switchFlag = move.selfSwitch;
		}
		return damage;
	},

	canMegaEvo: function (pokemon) {
		var altForme = pokemon.baseTemplate.otherFormes && this.getTemplate(pokemon.baseTemplate.otherFormes[0]);
		if (altForme && altForme.isMega && altForme.requiredMove && pokemon.moves.indexOf(toId(altForme.requiredMove)) >= 0) return altForme.species;
		var item = pokemon.getItem();
		if (item.megaEvolves !== pokemon.baseTemplate.baseSpecies || item.megaStone === pokemon.species) return false;
		return item.megaStone;
	},

	runMegaEvo: function (pokemon) {
		var template = this.getTemplate(pokemon.canMegaEvo);
		var side = pokemon.side;

		// Pokémon affected by Sky Drop cannot mega evolve. Enforce it here for now.
		var foeActive = side.foe.active;
		for (var i = 0; i < foeActive.length; i++) {
			if (foeActive[i].volatiles['skydrop'] && foeActive[i].volatiles['skydrop'].source === pokemon) {
				return false;
			}
		}

		pokemon.formeChange(template);
		pokemon.baseTemplate = template; // mega evolution is permanent
		pokemon.details = template.species + (pokemon.level === 100 ? '' : ', L' + pokemon.level) + (pokemon.gender === '' ? '' : ', ' + pokemon.gender) + (pokemon.set.shiny ? ', shiny' : '');
		this.add('detailschange', pokemon, pokemon.details);
		this.add('-mega', pokemon, template.baseSpecies, template.requiredItem);
		pokemon.setAbility(template.abilities['0']);
		pokemon.baseAbility = pokemon.ability;

		// Limit one mega evolution
		for (var i = 0; i < side.pokemon.length; i++) {
			side.pokemon[i].canMegaEvo = false;
		}
		return true;
	},

	isAdjacent: function (pokemon1, pokemon2) {
		if (pokemon1.fainted || pokemon2.fainted) return false;
		if (pokemon1.side === pokemon2.side) return Math.abs(pokemon1.position - pokemon2.position) === 1;
		return Math.abs(pokemon1.position + pokemon2.position + 1 - pokemon1.side.active.length) <= 1;
	},
	checkAbilities: function (selectedAbilities, defaultAbilities) {
		if (!selectedAbilities.length) return true;
		var selectedAbility = selectedAbilities.pop();
		var isValid = false;
		for (var i = 0; i < defaultAbilities.length; i++) {
			var defaultAbility = defaultAbilities[i];
			if (!defaultAbility) break;
			if (defaultAbility.indexOf(selectedAbility) >= 0) {
				defaultAbilities.splice(i, 1);
				isValid = this.checkAbilities(selectedAbilities, defaultAbilities);
				if (isValid) break;
				defaultAbilities.splice(i, 0, defaultAbility);
			}
		}
		if (!isValid) selectedAbilities.push(selectedAbility);
		return isValid;
	},
	sampleNoReplace: function (list) {
		var length = list.length;
		var index = this.random(length);
		var element = list[index];
		for (var nextIndex = index + 1; nextIndex < length; index += 1, nextIndex += 1) {
			list[index] = list[nextIndex];
		}
		list.pop();
		return element;
	},
	hasMegaEvo: function (template) {
		if (template.otherFormes) {
			var forme = this.getTemplate(template.otherFormes[0]);
			if (forme.requiredItem) {
				var item = this.getItem(forme.requiredItem);
				if (item.megaStone) return true;
			} else if (forme.requiredMove && forme.isMega) {
				return true;
			}
		}
		return false;
	},
	getTeam: function (side, team) {
		var format = side.battle.getFormat();
		if (typeof format.team === 'string' && format.team.substr(0, 6) === 'random') {
			return this[format.team + 'Team'](side);
		} else if (team) {
			return team;
		} else {
			return this.randomTeam(side);
		}
	},
	randomCCTeam: function (side) {
		var team = [];

		var natures = Object.keys(this.data.Natures);
		var items = Object.keys(this.data.Items);

		var hasDexNumber = {};
		var formes = [[], [], [], [], [], []];

		// Pick six random pokemon--no repeats, even among formes
		// Also need to either normalize for formes or select formes at random
		// Unreleased are okay but no CAP

		var num;
		for (var i = 0; i < 6; i++) {
			do {
				num = this.random(721) + 1;
			} while (num in hasDexNumber);
			hasDexNumber[num] = i;
		}

		for (var id in this.data.Pokedex) {
			if (!(this.data.Pokedex[id].num in hasDexNumber)) continue;
			var template = this.getTemplate(id);
			if (template.species !== 'Pichu-Spiky-eared') {
				formes[hasDexNumber[template.num]].push(template.species);
			}
		}

		for (var i = 0; i < 6; i++) {
			var poke = formes[i][this.random(formes[i].length)];
			var template = this.getTemplate(poke);

			// Random item
			var item = items[this.random(items.length)];

			// Make sure forme is legal
			if ((template.requiredItem && item !== template.requiredItem) || template.num === 351 ||
					template.num === 421 || template.num === 555 || template.num === 648 || template.num === 681 ||
					template.species.indexOf('-Mega') >= 0 || template.species.indexOf('-Primal') >= 0) {
				template = this.getTemplate(template.baseSpecies);
				poke = template.name;
			}

			// Make sure forme/item combo is correct
			while ((poke === 'Arceus' && item.substr(-5) === 'plate') ||
					(poke === 'Giratina' && item === 'griseousorb') ||
					(poke === 'Genesect' && item.substr(-5) === 'drive')) {
				item = items[this.random(items.length)];
			}

			// Random ability
			var abilities = [template.abilities['0']];
			if (template.abilities['1']) {
				abilities.push(template.abilities['1']);
			}
			if (template.abilities['H']) {
				abilities.push(template.abilities['H']);
			}
			var ability = abilities[this.random(abilities.length)];

			// Four random unique moves from the movepool
			var moves;
			var pool = ['struggle'];
			if (poke === 'Smeargle') {
				pool = Object.keys(this.data.Movedex).exclude('chatter', 'struggle', 'magikarpsrevenge');
			} else if (template.learnset) {
				pool = Object.keys(template.learnset);
			} else {
				pool = Object.keys(this.getTemplate(template.baseSpecies).learnset);
			}
			if (pool.length <= 4) {
				moves = pool;
			} else {
				moves = [this.sampleNoReplace(pool), this.sampleNoReplace(pool), this.sampleNoReplace(pool), this.sampleNoReplace(pool)];
			}

			// Random EVs
			var evs = {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0};
			var s = ["hp", "atk", "def", "spa", "spd", "spe"];
			var evpool = 510;
			do {
				var x = s[this.random(s.length)];
				var y = this.random(Math.min(256 - evs[x], evpool + 1));
				evs[x] += y;
				evpool -= y;
			} while (evpool > 0);

			// Random IVs
			var ivs = {hp: this.random(32), atk: this.random(32), def: this.random(32), spa: this.random(32), spd: this.random(32), spe: this.random(32)};

			// Random nature
			var nature = natures[this.random(natures.length)];

			// Level balance--calculate directly from stats rather than using some silly lookup table
			var mbstmin = 1307; // Sunkern has the lowest modified base stat total, and that total is 807

			var stats = template.baseStats;

			// Modified base stat total assumes 31 IVs, 85 EVs in every stat
			var mbst = (stats["hp"] * 2 + 31 + 21 + 100) + 10;
			mbst += (stats["atk"] * 2 + 31 + 21 + 100) + 5;
			mbst += (stats["def"] * 2 + 31 + 21 + 100) + 5;
			mbst += (stats["spa"] * 2 + 31 + 21 + 100) + 5;
			mbst += (stats["spd"] * 2 + 31 + 21 + 100) + 5;
			mbst += (stats["spe"] * 2 + 31 + 21 + 100) + 5;

			var level = Math.floor(100 * mbstmin / mbst); // Initial level guess will underestimate

			while (level < 100) {
				mbst = Math.floor((stats["hp"] * 2 + 31 + 21 + 100) * level / 100 + 10);
				mbst += Math.floor(((stats["atk"] * 2 + 31 + 21 + 100) * level / 100 + 5) * level / 100); // Since damage is roughly proportional to level
				mbst += Math.floor((stats["def"] * 2 + 31 + 21 + 100) * level / 100 + 5);
				mbst += Math.floor(((stats["spa"] * 2 + 31 + 21 + 100) * level / 100 + 5) * level / 100);
				mbst += Math.floor((stats["spd"] * 2 + 31 + 21 + 100) * level / 100 + 5);
				mbst += Math.floor((stats["spe"] * 2 + 31 + 21 + 100) * level / 100 + 5);

				if (mbst >= mbstmin) break;
				level++;
			}

			// Random gender--already handled by PS

			// Random happiness
			var happiness = this.random(256);

			// Random shininess
			var shiny = !this.random(1024);

			team.push({
				name: poke,
				item: item,
				ability: ability,
				moves: moves,
				evs: evs,
				ivs: ivs,
				nature: nature,
				level: level,
				happiness: happiness,
				shiny: shiny
			});
		}

		return team;
	},
	randomHCTeam: function (side) {
		var team = [];

		var itemPool = Object.keys(this.data.Items);
		var abilityPool = Object.keys(this.data.Abilities);
		var movePool = Object.keys(this.data.Movedex);
		var naturePool = Object.keys(this.data.Natures);

		var hasDexNumber = {};
		var formes = [[], [], [], [], [], []];

		// Pick six random pokemon--no repeats, even among formes
		// Also need to either normalize for formes or select formes at random
		// Unreleased are okay but no CAP

		var num;
		for (var i = 0; i < 6; i++) {
			do {
				num = this.random(721) + 1;
			} while (num in hasDexNumber);
			hasDexNumber[num] = i;
		}

		for (var id in this.data.Pokedex) {
			if (!(this.data.Pokedex[id].num in hasDexNumber)) continue;
			var template = this.getTemplate(id);
			if (template.learnset && template.species !== 'Pichu-Spiky-eared') {
				formes[hasDexNumber[template.num]].push(template.species);
			}
		}

		for (var i = 0; i < 6; i++) {
			// Choose forme
			var pokemon = formes[i][this.random(formes[i].length)];
			var template = this.getTemplate(pokemon);

			// Random unique item
			var item = '';
			do {
				item = this.sampleNoReplace(itemPool);
			} while (this.data.Items[item].isNonstandard);

			// Genesect forms are a sprite difference based on its Drives
			if (template.species.substr(0, 9) === 'Genesect-' && item !== toId(template.requiredItem)) pokemon = 'Genesect';

			// Random unique ability
			var ability = '';
			do {
				ability = this.sampleNoReplace(abilityPool);
			} while (this.data.Abilities[ability].isNonstandard);

			// Random unique moves
			var m = [];
			while (true) {
				var moveid = this.sampleNoReplace(movePool);
				if (!this.data.Movedex[moveid].isNonstandard && (moveid === 'hiddenpower' || moveid.substr(0, 11) !== 'hiddenpower')) {
					if (m.push(moveid) >= 4) break;
				}
			}

			// Random EVs
			var evs = {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0};
			var s = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
			var evpool = 510;
			do {
				var x = s[this.random(s.length)];
				var y = this.random(Math.min(256 - evs[x], evpool + 1));
				evs[x] += y;
				evpool -= y;
			} while (evpool > 0);

			// Random IVs
			var ivs = {hp: this.random(32), atk: this.random(32), def: this.random(32), spa: this.random(32), spd: this.random(32), spe: this.random(32)};

			// Random nature
			var nature = naturePool[this.random(naturePool.length)];

			// Level balance
			var mbstmin = 1307;
			var stats = template.baseStats;
			var mbst = (stats['hp'] * 2 + 31 + 21 + 100) + 10;
			mbst += (stats['atk'] * 2 + 31 + 21 + 100) + 5;
			mbst += (stats['def'] * 2 + 31 + 21 + 100) + 5;
			mbst += (stats['spa'] * 2 + 31 + 21 + 100) + 5;
			mbst += (stats['spd'] * 2 + 31 + 21 + 100) + 5;
			mbst += (stats['spe'] * 2 + 31 + 21 + 100) + 5;
			var level = Math.floor(100 * mbstmin / mbst);
			while (level < 100) {
				mbst = Math.floor((stats['hp'] * 2 + 31 + 21 + 100) * level / 100 + 10);
				mbst += Math.floor(((stats['atk'] * 2 + 31 + 21 + 100) * level / 100 + 5) * level / 100);
				mbst += Math.floor((stats['def'] * 2 + 31 + 21 + 100) * level / 100 + 5);
				mbst += Math.floor(((stats['spa'] * 2 + 31 + 21 + 100) * level / 100 + 5) * level / 100);
				mbst += Math.floor((stats['spd'] * 2 + 31 + 21 + 100) * level / 100 + 5);
				mbst += Math.floor((stats['spe'] * 2 + 31 + 21 + 100) * level / 100 + 5);
				if (mbst >= mbstmin) break;
				level++;
			}

			// Random happiness
			var happiness = this.random(256);

			// Random shininess
			var shiny = !this.random(1024);

			team.push({
				name: pokemon,
				item: item,
				ability: ability,
				moves: m,
				evs: evs,
				ivs: ivs,
				nature: nature,
				level: level,
				happiness: happiness,
				shiny: shiny
			});
		}

		return team;
	},
	queryMoves: function (moves, hasType, hasAbility) {
		// This is primarily a helper function for random setbuilder functions.
		var counter = {
			Physical: 0, Special: 0, Status: 0, damage: 0, recovery: 0, stab: 0,
			blaze: 0, overgrow: 0, swarm: 0, torrent: 0,
			adaptability: 0, ate: 0, bite: 0, contrary: 0, hustle: 0,
			ironfist: 0, serenegrace: 0, sheerforce: 0, skilllink: 0, technician: 0,
			inaccurate: 0, priority: 0, recoil: 0,
			physicalsetup: 0, specialsetup: 0, mixedsetup: 0, speedsetup: 0,
			damagingMoves: [],
			damagingMoveIndex: {},
			setupType: ''
		};

		if (!moves || !moves.length) return counter;
		if (!hasType) hasType = {};
		if (!hasAbility) hasAbility = {};

		// Moves that heal a fixed amount:
		var RecoveryMove = {
			milkdrink: 1, recover: 1, roost: 1, slackoff: 1, softboiled: 1
		};
		// Moves which drop stats:
		var ContraryMove = {
			leafstorm: 1, overheat: 1, closecombat: 1, superpower: 1, vcreate: 1
		};
		// Moves that boost Attack:
		var PhysicalSetup = {
			bellydrum:1, bulkup:1, coil:1, curse:1, dragondance:1, honeclaws:1, howl:1, poweruppunch:1, shiftgear:1, swordsdance:1
		};
		// Moves which boost Special Attack:
		var SpecialSetup = {
			calmmind:1, chargebeam:1, geomancy:1, nastyplot:1, quiverdance:1, tailglow:1
		};
		// Moves which boost Attack AND Special Attack:
		var MixedSetup = {
			growth:1, workup:1, shellsmash:1
		};
		// Moves which boost Speed:
		var SpeedSetup = {
			autotomize:1, agility:1, rockpolish:1
		};
		// Moves that shouldn't be the only STAB moves:
		var NoStab = {
			bounce:1, fakeout:1, flamecharge:1, quickattack:1, skyattack:1
		};

		// Iterate through all moves we've chosen so far and keep track of what they do:
		for (var k = 0; k < moves.length; k++) {
			var move = this.getMove(moves[k]);
			var moveid = move.id;
			if (move.damage || move.damageCallback) {
				// Moves that do a set amount of damage:
				counter['damage']++;
				counter.damagingMoves.push(move);
				counter.damagingMoveIndex[moveid] = k;
			} else {
				// Are Physical/Special/Status moves:
				counter[move.category]++;
			}
			// Moves that have a low base power:
			if (moveid === 'lowkick' || (move.basePower && move.basePower <= 60 && moveid !== 'rapidspin')) counter['technician']++;
			// Moves that hit multiple times:
			if (move.multihit && move.multihit[1] === 5) counter['skilllink']++;
			// Recoil:
			if (move.recoil) counter['recoil']++;
			// Moves which have a base power, but aren't super-weak like Rapid Spin:
			if (move.basePower > 30 || move.multihit || move.basePowerCallback || moveid === 'naturepower') {
				if (hasType[move.type]) {
					counter['adaptability']++;
					// STAB:
					// Certain moves aren't acceptable as a Pokemon's only STAB attack
					if (!(moveid in NoStab)) counter['stab']++;
				}
				if (hasAbility['Protean']) counter['stab']++;
				if (move.category === 'Physical') counter['hustle']++;
				if (move.type === 'Fire') counter['blaze']++;
				if (move.type === 'Grass') counter['overgrow']++;
				if (move.type === 'Bug') counter['swarm']++;
				if (move.type === 'Water') counter['torrent']++;
				if (move.type === 'Normal') {
					counter['ate']++;
					if (hasAbility['Aerilate'] || hasAbility['Pixilate'] || hasAbility['Refrigerate']) counter['stab']++;
				}
				if (move.flags['bite']) counter['bite']++;
				if (move.flags['punch']) counter['ironfist']++;
				counter.damagingMoves.push(move);
				counter.damagingMoveIndex[moveid] = k;
			}
			// Moves with secondary effects:
			if (move.secondary) {
				counter['sheerforce']++;
				if (move.secondary.chance >= 20) {
					counter['serenegrace']++;
				}
			}
			// Moves with low accuracy:
			if (move.accuracy && move.accuracy !== true && move.accuracy < 90) counter['inaccurate']++;
			// Moves with non-zero priority:
			if (move.priority !== 0) counter['priority']++;

			// Moves that change stats:
			if (RecoveryMove[moveid]) counter['recovery']++;
			if (ContraryMove[moveid]) counter['contrary']++;
			if (PhysicalSetup[moveid]) {
				counter['physicalsetup']++;
				if (!counter.setupType) counter.setupType = 'Physical';
			}
			if (SpecialSetup[moveid]) {
				counter['specialsetup']++;
				if (!counter.setupType) counter.setupType = 'Special';
			}
			if (MixedSetup[moveid]) {
				counter['mixedsetup']++;
				counter.setupType = 'Mixed';
			}
			if (SpeedSetup[moveid]) counter['speedsetup']++;
		}

		// Choose a setup type:
		if (!counter['mixedsetup'] && counter['physicalsetup'] && counter['specialsetup'] && counter.Physical !== counter.Special) {
			counter.setupType = (counter.Physical > counter.Special) ? 'Physical' : 'Special';
		}

		return counter;
	},
	randomSet: function (template, slot, teamDetails) {
		if (slot === undefined) slot = 1;
		var baseTemplate = (template = this.getTemplate(template));
		var name = template.name;

		if (!template.exists || (!template.randomBattleMoves && !template.learnset)) {
			// GET IT? UNOWN? BECAUSE WE CAN'T TELL WHAT THE POKEMON IS
			template = this.getTemplate('unown');

			var stack = 'Template incompatible with random battles: ' + name;
			var fakeErr = {stack: stack};
			require('../crashlogger.js')(fakeErr, 'The randbat set generator');
		}

		if (typeof teamDetails !== 'object') teamDetails = {megaCount: teamDetails};

		// Castform-Sunny and Castform-Rainy can be chosen
		if (template.num === 351) {
			name = 'Castform';
		}
		// Meloetta-P can be chosen
		if (template.num === 648) {
			name = 'Meloetta';
		}

		// Decide if the Pokemon can mega evolve early, so viable moves for the mega can be generated
		if (!teamDetails.megaCount && this.hasMegaEvo(template)) {
			// If there's more than one mega evolution, randomly pick one
			template = this.getTemplate(template.otherFormes[this.random(template.otherFormes.length)]);
		}
		if (template.otherFormes && this.getTemplate(template.otherFormes[0]).isPrimal && this.random(2)) {
			template = this.getTemplate(template.otherFormes[0]);
		}

		var movePool = (template.randomBattleMoves ? template.randomBattleMoves.slice() : Object.keys(template.learnset));
		var moves = [];
		var ability = '';
		var item = '';
		var evs = {
			hp: 85,
			atk: 85,
			def: 85,
			spa: 85,
			spd: 85,
			spe: 85
		};
		var ivs = {
			hp: 31,
			atk: 31,
			def: 31,
			spa: 31,
			spd: 31,
			spe: 31
		};
		var hasType = {};
		hasType[template.types[0]] = true;
		if (template.types[1]) {
			hasType[template.types[1]] = true;
		}
		var hasAbility = {};
		hasAbility[template.abilities[0]] = true;
		if (template.abilities[1]) {
			hasAbility[template.abilities[1]] = true;
		}
		if (template.abilities['H']) {
			hasAbility[template.abilities['H']] = true;
		}
		var availableHP = 0;
		for (var i = 0, len = movePool.length; i < len; i++) {
			if (movePool[i].substr(0, 11) === 'hiddenpower') availableHP++;
		}

		// These moves can be used even if we aren't setting up to use them:
		var SetupException = {
			dracometeor:1, leafstorm:1, overheat:1,
			extremespeed:1, suckerpunch:1, superpower:1
		};
		var counterAbilities = {
			'Adaptability':1, 'Blaze':1, 'Contrary':1, 'Hustle':1, 'Iron Fist':1,
			'Overgrow':1, 'Skill Link':1, 'Swarm':1, 'Technician':1, 'Torrent':1
		};
		var ateAbilities = {
			'Aerilate':1, 'Pixilate':1, 'Refrigerate':1
		};

		var hasMove, counter;

		do {
			// Keep track of all moves we have:
			hasMove = {};
			for (var k = 0; k < moves.length; k++) {
				if (moves[k].substr(0, 11) === 'hiddenpower') {
					hasMove['hiddenpower'] = true;
				} else {
					hasMove[moves[k]] = true;
				}
			}

			// Choose next 4 moves from learnset/viable moves and add them to moves list:
			while (moves.length < 4 && movePool.length) {
				var moveid = this.sampleNoReplace(movePool);
				if (moveid.substr(0, 11) === 'hiddenpower') {
					availableHP--;
					if (hasMove['hiddenpower']) continue;
					hasMove['hiddenpower'] = true;
				} else {
					hasMove[moveid] = true;
				}
				moves.push(moveid);
			}

			counter = this.queryMoves(moves, hasType, hasAbility);

			// Iterate through the moves again, this time to cull them:
			for (var k = 0; k < moves.length; k++) {
				var moveid = moves[k];
				var move = this.getMove(moveid);
				var rejected = false;
				var isSetup = false;

				switch (moveid) {

				// Not very useful without their supporting moves
				case 'batonpass':
					if (!counter.setupType && !counter['speedsetup'] && !hasMove['cosmicpower'] && !hasMove['substitute'] && !hasMove['wish'] && !hasAbility['Speed Boost']) rejected = true;
					break;
				case 'focuspunch':
					if (!hasMove['substitute'] || (hasMove['rest'] && hasMove['sleeptalk'])) rejected = true;
					break;
				case 'perishsong':
					if (!hasMove['protect']) rejected = true;
					break;
				case 'rest':
					if (!hasMove['sleeptalk'] && movePool.indexOf('sleeptalk') >= 0) rejected = true;
					break;
				case 'sleeptalk':
					if (!hasMove['rest']) rejected = true;
					break;
				case 'storedpower':
					if (!counter.setupType && !hasMove['cosmicpower']) rejected = true;
					break;

				// Set up once and only if we have the moves for it
				case 'bellydrum': case 'bulkup': case 'coil': case 'curse': case 'dragondance': case 'honeclaws': case 'swordsdance':
					if (counter.setupType !== 'Physical' || counter['physicalsetup'] > 1) rejected = true;
					if (counter.Physical < 2 && !hasMove['batonpass'] && (!hasMove['rest'] || !hasMove['sleeptalk'])) rejected = true;
					isSetup = true;
					break;
				case 'calmmind': case 'geomancy': case 'nastyplot': case 'quiverdance': case 'tailglow':
					if (counter.setupType !== 'Special' || counter['specialsetup'] > 1) rejected = true;
					if (counter.Special < 2 && !hasMove['batonpass'] && (!hasMove['rest'] || !hasMove['sleeptalk'])) rejected = true;
					isSetup = true;
					break;
				case 'growth': case 'shellsmash': case 'workup':
					if (counter.setupType !== 'Mixed' || counter['mixedsetup'] > 1) rejected = true;
					if (counter.Physical + counter.Special < 2 && !hasMove['batonpass']) rejected = true;
					isSetup = true;
					break;
				case 'agility': case 'autotomize': case 'rockpolish':
					if (counter.Physical + counter.Special < 2 && !counter.setupType && !hasMove['batonpass']) rejected = true;
					if (hasMove['rest'] && hasMove['sleeptalk']) rejected = true;
					break;
				case 'flamecharge':
					if (counter.Physical + counter.Special < 3 && !counter.setupType && !hasMove['batonpass']) rejected = true;
					if (hasMove['dracometeor'] || hasMove['overheat']) rejected = true;
					break;

				// Bad after setup
				case 'circlethrow': case 'dragontail':
					if (!!counter['speedsetup'] || hasMove['encore'] || hasMove['raindance'] || hasMove['roar'] || hasMove['whirlwind']) rejected = true;
					if (counter.setupType && hasMove['stormthrow']) rejected = true;
					break;
				case 'defog': case 'rapidspin':
					if (counter.setupType || !!counter['speedsetup'] || (hasMove['rest'] && hasMove['sleeptalk']) || teamDetails.hazardClear >= 1) rejected = true;
					break;
				case 'fakeout':
					if (counter.setupType || hasMove['substitute'] || hasMove['switcheroo'] || hasMove['trick']) rejected = true;
					break;
				case 'foulplay': case 'nightshade': case 'seismictoss': case 'superfang':
					if (counter.setupType) rejected = true;
					break;
				case 'haze': case 'healingwish': case 'pursuit': case 'spikes': case 'toxicspikes': case 'waterspout':
					if (counter.setupType || !!counter['speedsetup'] || (hasMove['rest'] && hasMove['sleeptalk'])) rejected = true;
					break;
				case 'healbell':
					if (!!counter['speedsetup']) rejected = true;
					break;
				case 'memento':
					if (counter.setupType || !!counter['recovery'] || hasMove['substitute']) rejected = true;
					break;
				case 'protect':
					if (counter.setupType && (hasAbility['Guts'] || hasAbility['Speed Boost']) && !hasMove['batonpass']) rejected = true;
					if (hasMove['rest'] && hasMove['sleeptalk']) rejected = true;
					break;
				case 'stealthrock':
					if (counter.setupType || !!counter['speedsetup'] || hasMove['rest'] || teamDetails.stealthRock >= 1) rejected = true;
					break;
				case 'switcheroo': case 'trick':
					if (counter.setupType || counter.Physical + counter.Special < 2) rejected = true;
					if (hasMove['acrobatics'] || hasMove['lightscreen'] || hasMove['reflect'] || hasMove['trickroom']) rejected = true;
					break;
				case 'trickroom':
					if (counter.setupType || !!counter['speedsetup'] || counter.Physical + counter.Special < 2) rejected = true;
					if (hasMove['lightscreen'] || hasMove['reflect']) rejected = true;
					break;
				case 'uturn':
					if (counter.setupType || !!counter['speedsetup']) rejected = true;
					break;
				case 'voltswitch':
					if (counter.setupType || !!counter['speedsetup'] || hasMove['magnetrise'] || hasMove['uturn']) rejected = true;
					break;

				// Bit redundant to have both
				// Attacks:
				case 'bugbite':
					if (hasMove['uturn'] && !counter.setupType) rejected = true;
					break;
				case 'darkpulse':
					if (hasMove['crunch'] && counter.setupType !== 'Special') rejected = true;
					break;
				case 'foulplay':
					if (hasMove['darkpulse'] || hasMove['knockoff']) rejected = true;
					break;
				case 'suckerpunch':
					if ((hasMove['crunch'] || hasMove['darkpulse']) && (hasMove['knockoff'] || hasMove['pursuit'])) rejected = true;
					if (!counter.setupType && hasMove['foulplay'] && (hasMove['darkpulse'] || hasMove['pursuit'])) rejected = true;
					if (hasMove['rest'] && hasMove['sleeptalk']) rejected = true;
					break;
				case 'dragonclaw':
					if (hasMove['outrage'] || hasMove['dragontail']) rejected = true;
					break;
				case 'dragonpulse': case 'spacialrend':
					if (hasMove['dracometeor']) rejected = true;
					break;
				case 'outrage':
					if (hasMove['dracometeor'] && counter.damagingMoves.length < 3) rejected = true;
					break;
				case 'thunder':
					if (hasMove['thunderbolt'] && !hasMove['raindance']) rejected = true;
					break;
				case 'thunderbolt':
					if (hasMove['discharge'] || (hasMove['thunder'] && hasMove['raindance']) || (hasMove['voltswitch'] && hasMove['wildcharge'])) rejected = true;
					break;
				case 'drainingkiss':
					if (hasMove['dazzlinggleam'] || counter.setupType !== 'Special') rejected = true;
					break;
				case 'aurasphere': case 'drainpunch':
					if (!hasMove['bulkup'] && (hasMove['closecombat'] || hasMove['highjumpkick'])) rejected = true;
					if (hasMove['focusblast'] || hasMove['superpower']) rejected = true;
					break;
				case 'closecombat': case 'highjumpkick':
					if (hasMove['bulkup'] && hasMove['drainpunch']) rejected = true;
					break;
				case 'focusblast':
					if (!counter.setupType && (hasMove['closecombat'] || hasMove['superpower'])) rejected = true;
					if (hasMove['rest'] && hasMove['sleeptalk']) rejected = true;
					break;
				case 'stormthrow':
					if (hasMove['circlethrow'] && (hasMove['rest'] && hasMove['sleeptalk'])) rejected = true;
					break;
				case 'superpower':
					if (counter.setupType && (hasMove['drainpunch'] || hasMove['focusblast'])) rejected = true;
					break;
				case 'fierydance': case 'flamethrower':
					if (hasMove['fireblast'] || hasMove['overheat']) rejected = true;
					break;
				case 'fireblast':
					if ((hasMove['flareblitz'] || hasMove['lavaplume']) && !counter.setupType && !counter['speedsetup']) rejected = true;
					break;
				case 'firepunch': case 'sacredfire':
					if (hasMove['fireblast'] || hasMove['flareblitz']) rejected = true;
					break;
				case 'lavaplume':
					if (hasMove['fireblast'] && (counter.setupType || !!counter['speedsetup'])) rejected = true;
					break;
				case 'overheat':
					if (hasMove['lavaplume'] || counter.setupType === 'Special') rejected = true;
					break;
				case 'acrobatics': case 'airslash': case 'oblivionwing':
					if (hasMove['bravebird'] || hasMove['hurricane']) rejected = true;
					break;
				case 'phantomforce': case 'shadowforce': case 'shadowsneak':
					if (hasMove['shadowclaw'] || (hasMove['rest'] && hasMove['sleeptalk'])) rejected = true;
					break;
				case 'shadowclaw':
					if (hasMove['shadowball']) rejected = true;
					break;
				case 'solarbeam':
					if ((!hasAbility['Drought'] && !hasMove['sunnyday']) || hasMove['gigadrain'] || hasMove['leafstorm']) rejected = true;
					break;
				case 'gigadrain':
					if ((!counter.setupType && hasMove['leafstorm']) || hasMove['petaldance']) rejected = true;
					break;
				case 'leafblade': case 'seedbomb': case 'woodhammer':
					if (hasMove['gigadrain'] && counter.setupType !== 'Physical') rejected = true;
					break;
				case 'leafstorm':
					if (counter.setupType && hasMove['gigadrain']) rejected = true;
					break;
				case 'bonemerang': case 'precipiceblades':
					if (hasMove['earthquake']) rejected = true;
					break;
				case 'icebeam':
					if (hasMove['blizzard'] || hasMove['freezedry']) rejected = true;
					break;
				case 'bodyslam':
					if (hasMove['glare']) rejected = true;
					break;
				case 'explosion':
					if (counter.setupType || hasMove['wish']) rejected = true;
					break;
				case 'hiddenpower':
					if (hasMove['rest'] && hasMove['sleeptalk']) rejected = true;
					break;
				case 'hypervoice':
					if (hasMove['naturepower'] || hasMove['return']) rejected = true;
					break;
				case 'judgment':
					if (counter.stab) rejected = true;
					break;
				case 'return': case 'rockclimb':
					if (hasMove['bodyslam'] || hasMove['doubleedge']) rejected = true;
					break;
				case 'weatherball':
					if (!hasMove['raindance'] && !hasMove['sunnyday']) rejected = true;
					break;
				case 'poisonjab':
					if (hasMove['gunkshot']) rejected = true;
					break;
				case 'psychic':
					if (hasMove['psyshock'] || hasMove['storedpower']) rejected = true;
					break;
				case 'zenheadbutt':
					if (hasMove['psyshock'] && counter.setupType !== 'Physical') rejected = true;
					break;
				case 'headsmash':
					if (hasMove['stoneedge']) rejected = true;
					break;
				case 'rockblast': case 'rockslide':
					if (hasMove['headsmash'] || hasMove['stoneedge']) rejected = true;
					break;
				case 'flashcannon':
					if (hasMove['ironhead']) rejected = true;
					break;
				case 'hydropump':
					if (hasMove['razorshell'] || hasMove['scald'] || hasMove['waterfall'] || (hasMove['rest'] && hasMove['sleeptalk'])) rejected = true;
					break;
				case 'originpulse': case 'surf':
					if (hasMove['hydropump'] || hasMove['scald']) rejected = true;
					break;
				case 'scald':
					if (hasMove['waterfall'] || hasMove['waterpulse']) rejected = true;
					break;

				// Status:
				case 'raindance':
					if ((hasMove['rest'] && hasMove['sleeptalk']) || counter.Physical + counter.Special < 2) rejected = true;
					break;
				case 'sunnyday':
					if (!hasAbility['Chlorophyll'] && !hasAbility['Flower Gift'] && !hasAbility['Forecast'] && !hasMove['solarbeam']) rejected = true;
					if ((hasMove['rest'] && hasMove['sleeptalk']) || counter.Physical + counter.Special < 2) rejected = true;
					break;
				case 'stunspore': case 'thunderwave':
					if (counter.setupType || !!counter['speedsetup']) rejected = true;
					if (hasMove['discharge'] || hasMove['gyroball'] || hasMove['sleeppowder'] || hasMove['spore'] || hasMove['trickroom'] || hasMove['yawn']) rejected = true;
					if (hasMove['rest'] && hasMove['sleeptalk']) rejected = true;
					break;
				case 'toxic':
					if (hasMove['flamecharge']) rejected = true;
					if (hasMove['hypnosis'] || hasMove['sleeppowder'] || hasMove['stunspore'] || hasMove['thunderwave'] || hasMove['willowisp'] || hasMove['yawn']) rejected = true;
					if (hasMove['rest'] && hasMove['sleeptalk']) rejected = true;
					break;
				case 'willowisp':
					if (hasMove['lavaplume'] || hasMove['sacredfire'] || hasMove['scald'] || hasMove['spore']) rejected = true;
					break;
				case 'moonlight': case 'painsplit': case 'recover': case 'roost': case 'softboiled': case 'synthesis':
					if (hasMove['rest'] || hasMove['wish']) rejected = true;
					break;
				case 'roar':
					if (hasMove['dragontail']) rejected = true;
					break;
				case 'safeguard':
					if (hasMove['destinybond']) rejected = true;
					break;
				case 'substitute':
					if (hasMove['dracometeor'] || (hasMove['leafstorm'] && !hasAbility['Contrary']) || hasMove['pursuit'] || hasMove['taunt'] || hasMove['uturn'] || hasMove['voltswitch']) rejected = true;
					break;
				}

				// Increased/decreased priority moves unneeded with moves that boost only speed
				if (move.priority !== 0 && !!counter['speedsetup']) {
					rejected = true;
				}

				if (move.category === 'Special' && counter.setupType === 'Physical' && !SetupException[move.id]) {
					rejected = true;
				}
				if (move.category === 'Physical' && (counter.setupType === 'Special' || hasMove['acidspray']) && !SetupException[move.id]) {
					rejected = true;
				}

				// This move doesn't satisfy our setup requirements:
				if (counter.setupType && counter.setupType !== 'Mixed' && move.category !== counter.setupType && counter[counter.setupType] < 2 && !hasMove['batonpass']) {
					// Mono-attacking with setup and RestTalk is allowed
					if (!isSetup && moveid !== 'rest' && moveid !== 'sleeptalk') rejected = true;
				}

				// Hidden Power isn't good enough for most cases with Special setup
				if (counter.setupType === 'Special' && move.id === 'hiddenpower' && counter['Special'] <= 2 && (!hasMove['shadowball'] || move.type !== 'Fighting') && (!hasType['Electric'] || move.type !== 'Ice') && template.species !== 'Lilligant') {
					rejected = true;
				}

				// Remove rejected moves from the move list
				if (rejected && (movePool.length - availableHP || availableHP && (move.id === 'hiddenpower' || !hasMove['hiddenpower']))) {
					moves.splice(k, 1);
					break;
				}

				// Handle Hidden Power IVs
				if (move.id === 'hiddenpower') {
					var HPivs = this.getType(move.type).HPivs;
					for (var iv in HPivs) {
						ivs[iv] = HPivs[iv];
					}
				}
			}
			if (movePool.length && moves.length === 4 && !hasMove['counter'] && !hasMove['judgment'] && !hasMove['metalburst'] && !hasMove['mirrorcoat']) {
				// Move post-processing:
				if (counter.damagingMoves.length === 0) {
					// A set shouldn't have no attacking moves
					moves.splice(this.random(moves.length), 1);
				} else if (counter.damagingMoves.length === 1) {
					var damagingid = counter.damagingMoves[0].id;
					if (movePool.length - availableHP || availableHP && (damagingid === 'hiddenpower' || !hasMove['hiddenpower'])) {
						var replace = false;
						if (damagingid in {focuspunch:1, suckerpunch:1} || (damagingid === 'hiddenpower' && !counter.stab)) {
							// Unacceptable as the only attacking move
							replace = true;
						} else if (!counter.damagingMoves[0].damage) {
							if (!counter.stab) {
								var damagingType = counter.damagingMoves[0].type;
								if (damagingType === 'Fairy') {
									// Mono-Fairy is acceptable for Psychic types
									if (!hasType['Psychic']) replace = true;
								} else if (damagingType === 'Ice') {
									if (hasType['Normal'] && template.types.length === 1) {
										// Mono-Ice is acceptable for special attacking Normal types that lack Boomburst and Hyper Voice
										if (counter.Physical >= 2 || movePool.indexOf('boomburst') >= 0 || movePool.indexOf('hypervoice') >= 0) replace = true;
									} else {
										replace = true;
									}
								} else {
									replace = true;
								}
							}
						}
						if (replace) moves.splice(counter.damagingMoveIndex[damagingid], 1);
					}
				} else if (counter.damagingMoves.length === 2 && !counter.stab) {
					// If you have two attacks, neither is STAB, and the combo isn't Electric/Ice or Fighting/Ghost, reject one of them at random.
					var type1 = counter.damagingMoves[0].type, type2 = counter.damagingMoves[1].type;
					var typeCombo = [type1, type2].sort().join('/');
					if (typeCombo !== 'Electric/Ice' && typeCombo !== 'Fighting/Ghost') {
						var rejectableMoves = [];
						var baseDiff = movePool.length - availableHP;
						if (baseDiff || availableHP && (!hasMove['hiddenpower'] || counter.damagingMoves[0].id === 'hiddenpower')) {
							rejectableMoves.push(counter.damagingMoveIndex[counter.damagingMoves[0].id]);
						}
						if (baseDiff || availableHP && (!hasMove['hiddenpower'] || counter.damagingMoves[1].id === 'hiddenpower')) {
							rejectableMoves.push(counter.damagingMoveIndex[counter.damagingMoves[1].id]);
						}
						if (rejectableMoves.length) {
							moves.splice(rejectableMoves[this.random(rejectableMoves.length)], 1);
						}
					}
				} else if (!counter.stab || ((hasAbility['Aerilate'] || hasAbility['Pixilate'] || hasAbility['Refrigerate']) && !counter['ate'])) {
					// If you have three or more attacks, and none of them are STAB, reject one of them at random.
					// Alternatively, if you have an -ate ability and no Normal moves, reject an attack move at random.
					var rejectableMoves = [];
					var baseDiff = movePool.length - availableHP;
					for (var l = 0; l < counter.damagingMoves.length; l++) {
						if (baseDiff || availableHP && (!hasMove['hiddenpower'] || counter.damagingMoves[l].id === 'hiddenpower')) {
							rejectableMoves.push(counter.damagingMoveIndex[counter.damagingMoves[l].id]);
						}
					}
					if (rejectableMoves.length) {
						moves.splice(rejectableMoves[this.random(rejectableMoves.length)], 1);
					}
				}
			}
		} while (moves.length < 4 && movePool.length);

		// Any moveset modification goes here:
		// moves[0] = 'safeguard';
		var changedMove = false;
		if (template.requiredItem && template.requiredItem.slice(-5) === 'Drive' && !hasMove['technoblast']) {
			delete hasMove[this.getMove(moves[3]).id];
			moves[3] = 'technoblast';
			hasMove['technoblast'] = true;
			changedMove = true;
		}
		if (template.requiredMove && !hasMove[toId(template.requiredMove)]) {
			delete hasMove[this.getMove(moves[3]).id];
			moves[3] = toId(template.requiredMove);
			hasMove[toId(template.requiredMove)] = true;
			changedMove = true;
		}

		// If Hidden Power has been removed, reset the IVs
		if (!hasMove['hiddenpower']) {
			ivs = {
				hp: 31,
				atk: 31,
				def: 31,
				spa: 31,
				spd: 31,
				spe: 31
			};
		}

		// Re-query in case a moveset modification occurred
		if (changedMove) counter = this.queryMoves(moves, hasType, hasAbility);

		var abilities = Object.values(baseTemplate.abilities).sort(function (a, b) {
			return this.getAbility(b).rating - this.getAbility(a).rating;
		}.bind(this));
		var ability0 = this.getAbility(abilities[0]);
		var ability1 = this.getAbility(abilities[1]);
		var ability2 = this.getAbility(abilities[2]);
		var ability = ability0.name;
		if (abilities[1]) {
			if (abilities[2] && ability2.rating === ability1.rating) {
				if (this.random(2)) ability1 = ability2;
			}
			if (ability0.rating <= ability1.rating) {
				if (this.random(2)) ability = ability1.name;
			} else if (ability0.rating - 0.6 <= ability1.rating) {
				if (!this.random(3)) ability = ability1.name;
			}

			var rejectAbility = false;
			if (ability in counterAbilities) {
				// Adaptability, Blaze, Contrary, Hustle, Iron Fist, Overgrow, Skill Link, Swarm, Technician, Torrent
				rejectAbility = !counter[toId(ability)];
			} else if (ability in ateAbilities) {
				rejectAbility = !counter['ate'];
			} else if (ability === 'Chlorophyll') {
				rejectAbility = !hasMove['sunnyday'];
			} else if (ability === 'Compound Eyes' || ability === 'No Guard') {
				rejectAbility = !counter['inaccurate'];
			} else if (ability === 'Defiant' || ability === 'Moxie') {
				rejectAbility = !counter['Physical'] && !hasMove['batonpass'];
			} else if (ability === 'Gluttony') {
				rejectAbility = true;
			} else if (ability === 'Limber') {
				rejectAbility = template.types.indexOf('Electric') >= 0;
			} else if (ability === 'Lightning Rod') {
				rejectAbility = template.types.indexOf('Ground') >= 0;
			} else if (ability === 'Moody') {
				rejectAbility = template.id !== 'bidoof';
			} else if (ability === 'Poison Heal') {
				rejectAbility = abilities.indexOf('Technician') >= 0 && !!counter['technician'];
			} else if (ability === 'Prankster') {
				rejectAbility = !counter['Status'];
			} else if (ability === 'Reckless' || ability === 'Rock Head') {
				rejectAbility = !counter['recoil'];
			} else if (ability === 'Serene Grace') {
				rejectAbility = !counter['serenegrace'] || template.id === 'chansey' || template.id === 'blissey';
			} else if (ability === 'Sheer Force') {
				rejectAbility = !counter['sheerforce'];
			} else if (ability === 'Simple') {
				rejectAbility = !counter.setupType && !hasMove['cosmicpower'] && !hasMove['flamecharge'];
			} else if (ability === 'Snow Cloak') {
				rejectAbility = !teamDetails['hail'];
			} else if (ability === 'Strong Jaw') {
				rejectAbility = !counter['bite'];
			} else if (ability === 'Sturdy') {
				rejectAbility = !!counter['recoil'] && !counter['recovery'];
			} else if (ability === 'Swift Swim') {
				rejectAbility = !hasMove['raindance'] && !teamDetails['rain'];
			} else if (ability === 'Unburden') {
				rejectAbility = template.baseStats.spe > 120 || (template.id === 'slurpuff' && !counter.setupType);
			}

			if (rejectAbility) {
				if (ability === ability1.name) { // or not
					ability = ability0.name;
				} else if (ability1.rating > 1) { // only switch if the alternative doesn't suck
					ability = ability1.name;
				}
			}
			if (abilities.indexOf('Chlorophyll') >= 0 && ability !== 'Solar Power' && hasMove['sunnyday']) {
				ability = 'Chlorophyll';
			}
			if (abilities.indexOf('Guts') >= 0 && ability !== 'Quick Feet' && hasMove['facade']) {
				ability = 'Guts';
			}
			if (abilities.indexOf('Swift Swim') >= 0 && hasMove['raindance']) {
				ability = 'Swift Swim';
			}
			if (abilities.indexOf('Unburden') >= 0 && hasMove['acrobatics']) {
				ability = 'Unburden';
			}
			if (template.id === 'ambipom' && !counter['technician']) {
				// If it doesn't qualify for Technician, Skill Link is useless on it
				// Might as well give it Pickup just in case
				ability = 'Pickup';
			} else if (template.id === 'aurorus' && ability === 'Snow Warning' && hasMove['hypervoice']) {
				for (var i = 0; i < moves.length; i++) {
					if (moves[i] === 'hypervoice') {
						moves[i] = 'blizzard';
						counter['ate'] = 0;
						break;
					}
				}
			} else if (template.baseSpecies === 'Basculin') {
				ability = 'Adaptability';
			} else if (template.id === 'combee') {
				// Combee always gets Hustle but its only physical move is Endeavor, which loses accuracy
				ability = 'Honey Gather';
			} else if (template.id === 'lilligant' && hasMove['petaldance']) {
				ability = 'Own Tempo';
			} else if (template.id === 'lopunny' && hasMove['switcheroo'] && this.random(3)) {
				ability = 'Klutz';
			} else if (template.id === 'mawilemega') {
				// Mega Mawile only needs Intimidate for a starting ability
				ability = 'Intimidate';
			} else if (template.id === 'rhyperior') {
				ability = 'Solid Rock';
			} else if (template.id === 'sigilyph') {
				ability = 'Magic Guard';
			} else if (template.id === 'unfezant') {
				ability = 'Super Luck';
			} else if (template.id === 'venusaurmega') {
				ability = 'Chlorophyll';
			}
		}

		if (hasMove['rockclimb'] && ability !== 'Sheer Force') {
			moves[moves.indexOf('rockclimb')] = 'doubleedge';
		}

		if (hasMove['gyroball']) {
			ivs.spe = 0;
			evs.atk += evs.spe;
			evs.spe = 0;
		} else if (hasMove['trickroom']) {
			ivs.spe = 0;
			evs.hp += evs.spe;
			evs.spe = 0;
		} else if (template.species === 'Shedinja') {
			evs.atk = 252;
			evs.hp = 0;
			evs.def = 0;
			evs.spd = 0;
		}

		item = 'Leftovers';
		if (template.requiredItem) {
			item = template.requiredItem;
		} else if (hasMove['magikarpsrevenge']) {
			// PoTD Magikarp
			item = 'Choice Band';
		} else if (template.species === 'Rotom-Fan') {
			// This is just to amuse Zarel
			item = 'Air Balloon';

		// First, the extra high-priority items
		} else if (template.species === 'Clamperl' && !hasMove['shellsmash']) {
			item = 'DeepSeaTooth';
		} else if (template.species === 'Cubone' || template.species === 'Marowak') {
			item = 'Thick Club';
		} else if (template.species === 'Dedenne') {
			item = 'Petaya Berry';
		} else if (template.species === 'Deoxys-Attack') {
			item = (slot === 0 && hasMove['stealthrock']) ? 'Focus Sash' : 'Life Orb';
		} else if (template.species === 'Farfetch\'d') {
			item = 'Stick';
		} else if (template.baseSpecies === 'Pikachu') {
			item = 'Light Ball';
		} else if (template.species === 'Shedinja') {
			item = 'Focus Sash';
		} else if (template.species === 'Unfezant' && counter['Physical'] >= 2) {
			item = 'Scope Lens';
		} else if (template.species === 'Unown') {
			item = 'Choice Specs';
		} else if (template.species === 'Wobbuffet') {
			item = hasMove['destinybond'] ? 'Custap Berry' : ['Leftovers', 'Sitrus Berry'][this.random(2)];
		} else if (ability === 'Imposter') {
			item = 'Choice Scarf';
		} else if (ability === 'Klutz' && hasMove['switcheroo']) {
			// To perma-taunt a Pokemon by giving it Assault Vest
			item = 'Assault Vest';
		} else if (hasMove['geomancy']) {
			item = 'Power Herb';
		} else if (ability === 'Magic Guard' && hasMove['psychoshift']) {
			item = 'Flame Orb';
		} else if (hasMove['switcheroo'] || hasMove['trick']) {
			var randomNum = this.random(2);
			if (counter.Physical >= 3 && (template.baseStats.spe >= 95 || randomNum)) {
				item = 'Choice Band';
			} else if (counter.Special >= 3 && (template.baseStats.spe >= 95 || randomNum)) {
				item = 'Choice Specs';
			} else {
				item = 'Choice Scarf';
			}
		} else if (template.evos.length) {
			item = 'Eviolite';
		} else if (hasMove['shellsmash']) {
			if (ability === 'Solid Rock' && counter['priority']) {
				item = 'Weakness Policy';
			} else {
				item = 'White Herb';
			}
		} else if (ability === 'Magic Guard' || ability === 'Sheer Force') {
			item = 'Life Orb';
		} else if (hasMove['bellydrum']) {
			item = 'Sitrus Berry';
		} else if (ability === 'Poison Heal' || ability === 'Toxic Boost' || hasMove['facade']) {
			item = 'Toxic Orb';
		} else if (ability === 'Harvest') {
			item = hasMove['rest'] ? 'Lum Berry' : 'Sitrus Berry';
		} else if (hasMove['rest'] && !hasMove['sleeptalk'] && ability !== 'Natural Cure' && ability !== 'Shed Skin') {
			item = (hasMove['raindance'] && ability === 'Hydration') ? 'Damp Rock' : 'Chesto Berry';
		} else if (hasMove['raindance']) {
			item = 'Damp Rock';
		} else if (hasMove['sandstorm']) {
			item = 'Smooth Rock';
		} else if (hasMove['sunnyday']) {
			item = 'Heat Rock';
		} else if (hasMove['lightscreen'] && hasMove['reflect']) {
			item = 'Light Clay';
		} else if (hasMove['acrobatics']) {
			item = 'Flying Gem';
		} else if (ability === 'Unburden') {
			if (hasMove['fakeout']) {
				item = 'Normal Gem';
			} else if (hasMove['dracometeor'] || hasMove['leafstorm'] || hasMove['overheat']) {
				item = 'White Herb';
			} else if (hasMove['substitute'] || counter.setupType) {
				item = 'Sitrus Berry';
			} else {
				item = 'Red Card';
				for (var m in moves) {
					var move = this.getMove(moves[m]);
					if (hasType[move.type] && move.basePower >= 90) {
						item = move.type + ' Gem';
						break;
					}
				}
			}

		// Medium priority
		} else if (ability === 'Guts') {
			item = hasMove['drainpunch'] ? 'Flame Orb' : 'Toxic Orb';
		} else if (((ability === 'Speed Boost' && !hasMove['substitute']) || (ability === 'Stance Change')) && counter.Physical + counter.Special > 2) {
			item = 'Life Orb';
		} else if (counter.Physical >= 4 && !hasMove['bodyslam'] && !hasMove['fakeout'] && !hasMove['flamecharge'] && !hasMove['rapidspin'] && !hasMove['suckerpunch']) {
			item = template.baseStats.spe > 82 && template.baseStats.spe < 109 && !counter['priority'] && this.random(3) ? 'Choice Scarf' : 'Choice Band';
		} else if (counter.Special >= 4 && !hasMove['acidspray'] && !hasMove['chargebeam'] && !hasMove['fierydance']) {
			item = template.baseStats.spe > 82 && template.baseStats.spe < 109 && !counter['priority'] && this.random(3) ? 'Choice Scarf' : 'Choice Specs';
		} else if (counter.Special >= 3 && hasMove['uturn'] && template.baseStats.spe > 82 && template.baseStats.spe < 109 && !counter['priority'] && this.random(3)) {
			item = 'Choice Scarf';
		} else if (hasMove['eruption'] || hasMove['waterspout']) {
			item = counter.Status <= 1 ? 'Expert Belt' : 'Leftovers';
		} else if ((hasMove['endeavor'] || hasMove['flail'] || hasMove['reversal']) && ability !== 'Sturdy') {
			item = 'Focus Sash';
		} else if (this.getEffectiveness('Ground', template) >= 2 && ability !== 'Levitate' && !hasMove['magnetrise']) {
			item = 'Air Balloon';
		} else if (hasMove['outrage'] && (counter.setupType || ability === 'Multiscale')) {
			item = 'Lum Berry';
		} else if (ability === 'Moody' || hasMove['clearsmog'] || hasMove['detect'] || hasMove['protect'] || hasMove['sleeptalk'] || hasMove['substitute']) {
			item = 'Leftovers';
		} else if (hasMove['lightscreen'] || hasMove['reflect']) {
			item = 'Light Clay';
		} else if (ability === 'Iron Barbs' || ability === 'Rough Skin') {
			item = 'Rocky Helmet';
		} else if (counter.Physical + counter.Special >= 4 && (template.baseStats.def + template.baseStats.spd > 189 || hasMove['rapidspin'])) {
			item = 'Assault Vest';
		} else if (counter.Physical + counter.Special >= 4) {
			item = (!!counter['ate'] || (hasMove['suckerpunch'] && !hasType['Dark'])) ? 'Life Orb' : 'Expert Belt';
		} else if (counter.Physical + counter.Special >= 3 && !!counter['speedsetup'] && template.baseStats.hp + template.baseStats.def + template.baseStats.spd >= 300) {
			item = 'Weakness Policy';
		} else if (counter.Physical + counter.Special >= 3 && ability !== 'Sturdy' && !hasMove['dragontail']) {
			item = (template.baseStats.hp + template.baseStats.def + template.baseStats.spd < 285 || !!counter['speedsetup'] || hasMove['trickroom']) ? 'Life Orb' : 'Leftovers';
		} else if (template.species === 'Palkia' && (hasMove['dracometeor'] || hasMove['spacialrend']) && hasMove['hydropump']) {
			item = 'Lustrous Orb';
		} else if (slot === 0 && ability !== 'Regenerator' && ability !== 'Sturdy' && !counter['recoil'] && template.baseStats.hp + template.baseStats.def + template.baseStats.spd < 285) {
			item = 'Focus Sash';

		// This is the "REALLY can't think of a good item" cutoff
		} else if (ability === 'Super Luck') {
			item = 'Scope Lens';
		} else if (ability === 'Sturdy' && hasMove['explosion'] && !counter['speedsetup']) {
			item = 'Custap Berry';
		} else if (hasType['Poison']) {
			item = 'Black Sludge';
		} else if (this.getEffectiveness('Rock', template) >= 1 || hasMove['dragontail']) {
			item = 'Leftovers';
		} else if (this.getImmunity('Ground', template) && this.getEffectiveness('Ground', template) >= 1 && ability !== 'Levitate' && ability !== 'Solid Rock' && !hasMove['magnetrise'] && !hasMove['sleeptalk']) {
			item = 'Air Balloon';
		} else if (counter.Status <= 1 && ability !== 'Sturdy') {
			item = 'Life Orb';
		} else {
			item = 'Leftovers';
		}

		// For Trick / Switcheroo
		if (item === 'Leftovers' && hasType['Poison']) {
			item = 'Black Sludge';
		}

		var levelScale = {
			LC: 87,
			'LC Uber': 86,
			NFE: 84,
			PU: 83,
			BL4: 82,
			NU: 81,
			BL3: 80,
			RU: 79,
			BL2: 78,
			UU: 77,
			BL: 76,
			OU: 75,
			CAP: 75,
			Unreleased: 75,
			Uber: 73,
			AG: 71
		};
		var customScale = {
			// Between OU and Uber
			Aegislash: 74, Blaziken: 74, 'Blaziken-Mega': 74, Genesect: 74, 'Genesect-Burn': 74, 'Genesect-Chill': 74, 'Genesect-Douse': 74, 'Genesect-Shock': 74, Greninja: 74, 'Kangaskhan-Mega': 74, 'Lucario-Mega': 74, 'Mawile-Mega': 74,

			// Not holding Mega Stone
			Banette: 83, Beedrill: 83, Glalie: 83, Lopunny: 83,
			Altaria: 81, Ampharos: 81, Charizard: 81,
			Aerodactyl: 79, Aggron: 79, Blastoise: 79, Gardevoir: 79, Manectric: 79, Sceptile: 79, Venusaur: 79,
			Diancie: 77, Metagross: 77, Sableye: 77,

			// Holistic judgment
			Ninetales: 79, Politoed: 79, Unown: 85, Wobbuffet: 79
		};
		var tier = template.tier;
		if (tier.charAt(0) === '(') {
			tier = tier.slice(1, -1);
		}
		var level = levelScale[tier] || 90;
		if (customScale[template.name]) level = customScale[template.name];

		if (template.name === 'Xerneas' && hasMove['geomancy']) level = 71;

		// Prepare HP for Belly Drum.
		if (hasMove['bellydrum'] && item === 'Sitrus Berry') {
			var hp = Math.floor(Math.floor(2 * template.baseStats.hp + ivs.hp + Math.floor(evs.hp / 4) + 100) * level / 100 + 10);
			if (hp % 2 > 0) {
				evs.hp -= 4;
				evs.atk += 4;
			}
		} else {
			// Prepare HP for double Stealth Rock weaknesses. Those are mutually exclusive with Belly Drum HP check.
			// First, 25% damage.
			if (this.getEffectiveness('Rock', template) === 1) {
				var hp = Math.floor(Math.floor(2 * template.baseStats.hp + ivs.hp + Math.floor(evs.hp / 4) + 100) * level / 100 + 10);
				if (hp % 4 === 0) {
					evs.hp -= 4;
					if (counter.Physical > counter.Special) {
						evs.atk += 4;
					} else {
						evs.spa += 4;
					}
				}
			}

			// Then, prepare it for 50% damage.
			if (this.getEffectiveness('Rock', template) === 2) {
				var hp = Math.floor(Math.floor(2 * template.baseStats.hp + ivs.hp + Math.floor(evs.hp / 4) + 100) * level / 100 + 10);
				if (hp % 2 === 0) {
					evs.hp -= 4;
					if (counter.Physical > counter.Special) {
						evs.atk += 4;
					} else {
						evs.spa += 4;
					}
				}
			}
		}

		return {
			name: name,
			moves: moves,
			ability: ability,
			evs: evs,
			ivs: ivs,
			item: item,
			level: level,
			shiny: !this.random(1024)
		};
	},
	randomTeam: function (side) {
		var pokemonLeft = 0;
		var pokemon = [];

		var pokemonPool = [];
		for (var id in this.data.FormatsData) {
			var template = this.getTemplate(id);
			if (!template.isMega && !template.isPrimal && !template.isNonstandard && template.randomBattleMoves) {
				pokemonPool.push(id);
			}
		}

		// PotD stuff
		var potd;
		if (Config.potd && 'Rule:potd' in this.getBanlistTable(this.getFormat())) {
			potd = this.getTemplate(Config.potd);
		}

		var typeCount = {};
		var typeComboCount = {};
		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var teamDetails = {megaCount: 0, stealthRock: 0, hazardClear: 0};

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			// Useless in Random Battle without greatly lowering the levels of everything else
			if (template.species === 'Unown') continue;

			var tier = template.tier;
			switch (tier) {
			case 'LC':
			case 'LC Uber':
			case 'NFE':
				if (puCount > 1) continue;
				break;
			case 'PU':
				// PUs are limited to 2 but have a 20% chance of being added anyway.
				if (puCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'Uber':
				// Ubers are limited to 2 but have a 20% chance of being added anyway.
				if (uberCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(18) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Castform':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Pumpkaboo':
				if (this.random(4) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Hoopa':
				if (this.random(2) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Pikachu is not a viable NFE Pokemon
				continue;
			}

			// Limit 2 of any type
			var types = template.types;
			var skip = false;
			for (var t = 0; t < types.length; t++) {
				if (typeCount[types[t]] > 1 && this.random(5) >= 1) {
					skip = true;
					break;
				}
			}
			if (skip) continue;

			if (potd && potd.exists) {
				// The Pokemon of the Day belongs in slot 2
				if (pokemon.length === 1) {
					template = potd;
					if (template.species === 'Magikarp') {
						template.randomBattleMoves = ['bounce', 'flail', 'splash', 'magikarpsrevenge'];
					} else if (template.species === 'Delibird') {
						template.randomBattleMoves = ['present', 'bestow'];
					}
				} else if (template.species === potd.species) {
					continue; // No, thanks, I've already got one
				}
			}

			var set = this.randomSet(template, pokemon.length, teamDetails);

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit 1 of any type combination
			var typeCombo = types.join();
			if (set.ability === 'Drought' || set.ability === 'Drizzle') {
				// Drought and Drizzle don't count towards the type combo limit
				typeCombo = set.ability;
			}
			if (typeCombo in typeComboCount) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && teamDetails.megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment type counters
			for (var t = 0; t < types.length; t++) {
				if (types[t] in typeCount) {
					typeCount[types[t]]++;
				} else {
					typeCount[types[t]] = 1;
				}
			}
			typeComboCount[typeCombo] = 1;

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU' || tier === 'LC' || tier === 'LC Uber' || tier === 'NFE') {
				puCount++;
			}

			// Increment mega, stealthrock, and base species counters
			if (isMegaSet) teamDetails.megaCount++;
			if (set.ability === 'Snow Warning') teamDetails['hail'] = 1;
			if (set.ability === 'Drizzle' || set.moves.indexOf('raindance') >= 0) teamDetails['rain'] = 1;
			if (set.moves.indexOf('stealthrock') >= 0) teamDetails.stealthRock++;
			if (set.moves.indexOf('defog') >= 0 || set.moves.indexOf('rapidspin') >= 0) teamDetails.hazardClear++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	},
	randomDoublesTeam: function (side) {
		var pokemonLeft = 0;
		var pokemon = [];

		var pokemonPool = [];
		for (var id in this.data.FormatsData) {
			var template = this.getTemplate(id);
			if (!template.isMega && !template.isPrimal && !template.isNonstandard && template.randomBattleMoves) {
				pokemonPool.push(id);
			}
		}

		// PotD stuff
		var potd;
		if (Config.potd && 'Rule:potd' in this.getBanlistTable(this.getFormat())) {
			potd = this.getTemplate(Config.potd);
		}

		var typeCount = {};
		var typeComboCount = {};
		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var megaCount = 0;

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			var tier = template.tier;
			switch (tier) {
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(18) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Castform':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Pumpkaboo':
				if (this.random(4) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Hoopa':
				if (this.random(2) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Pikachu is not a viable NFE Pokemon
				continue;
			}

			// Limit 2 of any type
			var types = template.types;
			var skip = false;
			for (var t = 0; t < types.length; t++) {
				if (typeCount[types[t]] > 1 && this.random(5) >= 1) {
					skip = true;
					break;
				}
			}
			if (skip) continue;

			if (potd && potd.exists) {
				// The Pokemon of the Day belongs in slot 3
				if (pokemon.length === 2) {
					template = potd;
				} else if (template.species === potd.species) {
					continue; // No, thanks, I've already got one
				}
			}

			var set = this.randomDoublesSet(template, pokemon.length, megaCount);

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit 1 of any type combination
			var typeCombo = types.join();
			if (set.ability === 'Drought' || set.ability === 'Drizzle') {
				// Drought and Drizzle don't count towards the type combo limit
				typeCombo = set.ability;
			}
			if (typeCombo in typeComboCount) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment type counters
			for (var t = 0; t < types.length; t++) {
				if (types[t] in typeCount) {
					typeCount[types[t]]++;
				} else {
					typeCount[types[t]] = 1;
				}
			}
			typeComboCount[typeCombo] = 1;

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU' || tier === 'LC' || tier === 'LC Uber' || tier === 'NFE') {
				puCount++;
			}

			// Increment mega and base species counters
			if (isMegaSet) megaCount++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	},
	randomDoublesSet: function (template, slot, noMega) {
		var baseTemplate = (template = this.getTemplate(template));
		var name = template.name;

		if (!template.exists || (!template.randomDoubleBattleMoves && !template.randomBattleMoves && !template.learnset)) {
			template = this.getTemplate('unown');

			var stack = 'Template incompatible with random battles: ' + name;
			var fakeErr = {stack: stack};
			require('../crashlogger.js')(fakeErr, 'The doubles randbat set generator');
		}

		// Castform-Sunny and Castform-Rainy can be chosen
		if (template.num === 351) {
			name = 'Castform';
		}
		// Meloetta-P can be chosen
		if (template.num === 648) {
			name = 'Meloetta';
		}

		// Decide if the Pokemon can mega evolve early, so viable moves for the mega can be generated
		if (!noMega && this.hasMegaEvo(template)) {
			// If there's more than one mega evolution, randomly pick one
			template = this.getTemplate(template.otherFormes[this.random(template.otherFormes.length)]);
		}
		if (template.otherFormes && this.getTemplate(template.otherFormes[0]).isPrimal && this.random(2)) {
			template = this.getTemplate(template.otherFormes[0]);
		}

		var movePool = (template.randomDoubleBattleMoves || template.randomBattleMoves);
		movePool = movePool ? movePool.slice() : Object.keys(template.learnset);

		var moves = [];
		var ability = '';
		var item = '';
		var evs = {
			hp: 0,
			atk: 0,
			def: 0,
			spa: 0,
			spd: 0,
			spe: 0
		};
		var ivs = {
			hp: 31,
			atk: 31,
			def: 31,
			spa: 31,
			spd: 31,
			spe: 31
		};
		var hasType = {};
		hasType[template.types[0]] = true;
		if (template.types[1]) {
			hasType[template.types[1]] = true;
		}
		var hasAbility = {};
		hasAbility[template.abilities[0]] = true;
		if (template.abilities[1]) {
			hasAbility[template.abilities[1]] = true;
		}
		if (template.abilities['H']) {
			hasAbility[template.abilities['H']] = true;
		}
		var availableHP = 0;
		for (var i = 0, len = movePool.length; i < len; i++) {
			if (movePool[i].substr(0, 11) === 'hiddenpower') availableHP++;
		}

		// These moves can be used even if we aren't setting up to use them:
		var SetupException = {
			dracometeor:1, leafstorm:1, overheat:1,
			extremespeed:1, suckerpunch:1, superpower:1
		};
		var counterAbilities = {
			'Blaze':1, 'Overgrow':1, 'Swarm':1, 'Torrent':1, 'Contrary':1,
			'Technician':1, 'Skill Link':1, 'Iron Fist':1, 'Adaptability':1, 'Hustle':1
		};
		// -ate Abilities
		var ateAbilities = {
			'Aerilate':1, 'Pixilate':1, 'Refrigerate':1
		};

		var hasMove, counter;

		do {
			// Keep track of all moves we have:
			hasMove = {};
			for (var k = 0; k < moves.length; k++) {
				if (moves[k].substr(0, 11) === 'hiddenpower') {
					hasMove['hiddenpower'] = true;
				} else {
					hasMove[moves[k]] = true;
				}
			}

			// Choose next 4 moves from learnset/viable moves and add them to moves list:
			while (moves.length < 4 && movePool.length) {
				var moveid = toId(this.sampleNoReplace(movePool));
				if (moveid.substr(0, 11) === 'hiddenpower') {
					availableHP--;
					if (hasMove['hiddenpower']) continue;
					hasMove['hiddenpower'] = true;
				} else {
					hasMove[moveid] = true;
				}
				moves.push(moveid);
			}

			counter = this.queryMoves(moves, hasType, hasAbility);

			// Iterate through the moves again, this time to cull them:
			for (var k = 0; k < moves.length; k++) {
				var moveid = moves[k];
				var move = this.getMove(moveid);
				var rejected = false;
				var isSetup = false;

				switch (moveid) {
				// not very useful without their supporting moves
				case 'sleeptalk':
					if (!hasMove['rest']) rejected = true;
					break;
				case 'endure':
					if (!hasMove['flail'] && !hasMove['endeavor'] && !hasMove['reversal']) rejected = true;
					break;
				case 'focuspunch':
					if (hasMove['sleeptalk'] || !hasMove['substitute']) rejected = true;
					break;
				case 'storedpower':
					if (!hasMove['cosmicpower'] && !counter.setupType) rejected = true;
					break;
				case 'batonpass':
					if (!counter.setupType && !hasMove['substitute'] && !hasMove['cosmicpower'] && !counter['speedsetup'] && !hasAbility['Speed Boost']) rejected = true;
					break;

				// we only need to set up once
				case 'swordsdance': case 'dragondance': case 'coil': case 'curse': case 'bulkup': case 'bellydrum':
					if (counter.Physical < 2 && !hasMove['batonpass']) rejected = true;
					if (counter.setupType !== 'Physical' || counter['physicalsetup'] > 1) rejected = true;
					isSetup = true;
					break;
				case 'nastyplot': case 'tailglow': case 'quiverdance': case 'calmmind': case 'geomancy':
					if (counter.Special < 2 && !hasMove['batonpass']) rejected = true;
					if (counter.setupType !== 'Special' || counter['specialsetup'] > 1) rejected = true;
					isSetup = true;
					break;
				case 'shellsmash': case 'growth': case 'workup':
					if (counter.Physical + counter.Special < 2 && !hasMove['batonpass']) rejected = true;
					if (counter.setupType !== 'Mixed' || counter['mixedsetup'] > 1) rejected = true;
					isSetup = true;
					break;

				// bad after setup
				case 'seismictoss': case 'nightshade': case 'superfang':
					if (counter.setupType) rejected = true;
					break;
				case 'rapidspin': case 'perishsong': case 'magiccoat': case 'spikes': case 'toxicspikes':
					if (counter.setupType) rejected = true;
					break;
				case 'uturn': case 'voltswitch':
					if (counter.setupType || hasMove['agility'] || hasMove['rockpolish'] || hasMove['magnetrise']) rejected = true;
					break;
				case 'relicsong':
					if (counter.setupType) rejected = true;
					break;
				case 'pursuit': case 'protect': case 'haze': case 'stealthrock':
					if (counter.setupType || (hasMove['rest'] && hasMove['sleeptalk'])) rejected = true;
					break;
				case 'trick': case 'switcheroo':
					if (counter.setupType || counter.Physical + counter.Special < 2) rejected = true;
					if ((hasMove['rest'] && hasMove['sleeptalk']) || hasMove['trickroom'] || hasMove['reflect'] || hasMove['lightscreen'] || hasMove['acrobatics']) rejected = true;
					break;
				case 'dragontail': case 'circlethrow':
					if (hasMove['agility'] || hasMove['rockpolish']) rejected = true;
					if (hasMove['whirlwind'] || hasMove['roar'] || hasMove['encore']) rejected = true;
					break;

				// bit redundant to have both
				// Attacks:
				case 'flamethrower': case 'fierydance':
					if (hasMove['heatwave'] || hasMove['overheat'] || hasMove['fireblast'] || hasMove['blueflare']) rejected = true;
					break;
				case 'overheat':
					if (counter.setupType === 'Special' || hasMove['fireblast']) rejected = true;
					break;
				case 'icebeam':
					if (hasMove['blizzard'] || hasMove['freezedry']) rejected = true;
					break;
				case 'surf':
					if (hasMove['scald'] || hasMove['hydropump'] || hasMove['muddywater']) rejected = true;
					break;
				case 'hydropump':
					if (hasMove['razorshell'] || hasMove['waterfall'] || hasMove['scald'] || hasMove['muddywater']) rejected = true;
					break;
				case 'waterfall':
					if (hasMove['aquatail']) rejected = true;
					break;
				case 'airslash':
					if (hasMove['hurricane']) rejected = true;
					break;
				case 'acrobatics': case 'pluck': case 'drillpeck':
					if (hasMove['bravebird']) rejected = true;
					break;
				case 'solarbeam':
					if ((!hasMove['sunnyday'] && !hasAbility['Drought']) || hasMove['gigadrain'] || hasMove['leafstorm']) rejected = true;
					break;
				case 'gigadrain':
					if ((!counter.setupType && hasMove['leafstorm']) || hasMove['petaldance']) rejected = true;
					break;
				case 'leafstorm':
					if (counter.setupType && hasMove['gigadrain']) rejected = true;
					break;
				case 'seedbomb': case 'woodhammer':
					if (hasMove['gigadrain']) rejected = true;
					break;
				case 'weatherball':
					if (!hasMove['sunnyday']) rejected = true;
					break;
				case 'firepunch':
					if (hasMove['flareblitz'] || hasMove['fireblast']) rejected = true;
					break;
				case 'crosschop': case 'highjumpkick':
					if (hasMove['closecombat']) rejected = true;
					break;
				case 'drainpunch':
					if (hasMove['closecombat'] || hasMove['crosschop']) rejected = true;
					break;
				case 'thunder':
					if (hasMove['thunderbolt']) rejected = true;
					break;
				case 'thunderbolt': case 'electroweb':
					if (hasMove['discharge']) rejected = true;
					break;
				case 'stoneedge':
					if (hasMove['rockslide'] || hasMove['headsmash'] || hasMove['rockblast']) rejected = true;
					break;
				case 'headsmash':
					if (hasMove['rockslide']) rejected = true;
					break;
				case 'bonemerang': case 'earthpower':
					if (hasMove['earthquake']) rejected = true;
					break;
				case 'outrage':
					if (hasMove['dragonclaw'] || hasMove['dragontail']) rejected = true;
					break;
				case 'ancientpower':
					if (hasMove['paleowave']) rejected = true;
					break;
				case 'dragonpulse':
					if (hasMove['dracometeor']) rejected = true;
					break;
				case 'moonblast':
					if (hasMove['dazzlinggleam']) rejected = true;
					break;
				case 'acidspray':
					if (hasMove['sludgebomb']) rejected = true;
					break;
				case 'return':
					if (hasMove['bodyslam'] || hasMove['facade'] || hasMove['doubleedge'] || hasMove['tailslap'] || hasMove['doublehit']) rejected = true;
					break;
				case 'poisonjab':
					if (hasMove['gunkshot']) rejected = true;
					break;
				case 'psychic':
					if (hasMove['psyshock'] || hasMove['hyperspacehole']) rejected = true;
					break;
				case 'fusionbolt':
					if (counter.setupType && hasMove['boltstrike']) rejected = true;
					break;
				case 'boltstrike':
					if (!counter.setupType && hasMove['fusionbolt']) rejected = true;
					break;
				case 'darkpulse':
					if (hasMove['crunch'] && counter.setupType !== 'Special') rejected = true;
					break;
				case 'quickattack':
					if (hasMove['feint']) rejected = true;
					break;
				case 'wideguard':
					if (hasMove['protect']) rejected = true;
					break;
				case 'powersplit':
					if (hasMove['guardsplit']) rejected = true;
					break;

				// Status:
				case 'rest':
					if (hasMove['painsplit'] || hasMove['wish'] || hasMove['recover'] || hasMove['moonlight'] || hasMove['synthesis']) rejected = true;
					break;
				case 'softboiled': case 'roost':
					if (hasMove['wish'] || hasMove['recover']) rejected = true;
					break;
				case 'perishsong':
					if (hasMove['roar'] || hasMove['whirlwind'] || hasMove['haze']) rejected = true;
					break;
				case 'roar':
					// Whirlwind outclasses Roar because Soundproof
					if (hasMove['whirlwind'] || hasMove['dragontail'] || hasMove['haze'] || hasMove['circlethrow']) rejected = true;
					break;
				case 'substitute':
					if (hasMove['uturn'] || hasMove['voltswitch'] || hasMove['pursuit']) rejected = true;
					break;
				case 'fakeout':
					if (hasMove['trick'] || hasMove['switcheroo'] || ability === 'Sheer Force')  rejected = true;
					break;
				case 'feint':
					if (hasMove['fakeout']) rejected = true;
					break;
				case 'encore':
					if (hasMove['rest'] && hasMove['sleeptalk']) rejected = true;
					if (hasMove['whirlwind'] || hasMove['dragontail'] || hasMove['roar'] || hasMove['circlethrow']) rejected = true;
					break;
				case 'suckerpunch':
					if (hasMove['rest'] && hasMove['sleeptalk']) rejected = true;
					break;
				case 'cottonguard':
					if (hasMove['reflect']) rejected = true;
					break;
				case 'lightscreen':
					if (hasMove['calmmind']) rejected = true;
					break;
				case 'rockpolish': case 'agility': case 'autotomize':
					if (!counter.setupType && !hasMove['batonpass'] && hasMove['thunderwave']) rejected = true;
					if ((hasMove['stealthrock'] || hasMove['spikes'] || hasMove['toxicspikes']) && !hasMove['batonpass']) rejected = true;
					break;
				case 'thunderwave':
					if (counter.setupType && (hasMove['rockpolish'] || hasMove['agility'])) rejected = true;
					if (hasMove['discharge'] || hasMove['trickroom']) rejected = true;
					if (hasMove['rest'] && hasMove['sleeptalk']) rejected = true;
					if (hasMove['yawn'] || hasMove['spore'] || hasMove['sleeppowder']) rejected = true;
					break;
				case 'lavaplume':
					if (hasMove['willowisp']) rejected = true;
					break;
				case 'trickroom':
					if (hasMove['rockpolish'] || hasMove['agility'] || hasMove['icywind']) rejected = true;
					break;
				case 'willowisp':
					if (hasMove['scald'] || hasMove['yawn'] || hasMove['spore'] || hasMove['sleeppowder']) rejected = true;
					break;
				case 'toxic':
					if (hasMove['thunderwave'] || hasMove['willowisp'] || hasMove['scald'] || hasMove['yawn'] || hasMove['spore'] || hasMove['sleeppowder']) rejected = true;
					break;
				}

				// Increased/decreased priority moves unneeded with moves that boost only speed
				if (move.priority !== 0 && (hasMove['rockpolish'] || hasMove['agility'])) {
					rejected = true;
				}

				if (move.category === 'Special' && counter.setupType === 'Physical' && !SetupException[move.id]) {
					rejected = true;
				}
				if (move.category === 'Physical' && (counter.setupType === 'Special' || hasMove['acidspray']) && !SetupException[move.id]) {
					rejected = true;
				}

				// This move doesn't satisfy our setup requirements:
				if (counter.setupType === 'Physical' && move.category !== 'Physical' && counter['Physical'] < 2) {
					rejected = true;
				}
				if (counter.setupType === 'Special' && move.category !== 'Special' && counter['Special'] < 2) {
					rejected = true;
				}

				// Hidden Power isn't good enough
				if (counter.setupType === 'Special' && move.id === 'hiddenpower' && counter['Special'] <= 2 && (!hasMove['shadowball'] || move.type !== 'Fighting')) {
					rejected = true;
				}

				// Remove rejected moves from the move list.
				if (rejected && (movePool.length - availableHP || availableHP && (move.id === 'hiddenpower' || !hasMove['hiddenpower']))) {
					moves.splice(k, 1);
					break;
				}

				// Handle HP IVs
				if (move.id === 'hiddenpower') {
					var HPivs = this.getType(move.type).HPivs;
					for (var iv in HPivs) {
						ivs[iv] = HPivs[iv];
					}
				}
			}
			if (movePool.length && moves.length === 4 && !hasMove['judgment']) {
				// Move post-processing:
				if (counter.damagingMoves.length === 0) {
					// A set shouldn't have no attacking moves
					moves.splice(this.random(moves.length), 1);
				} else if (counter.damagingMoves.length === 1) {
					var damagingid = counter.damagingMoves[0].id;
					// Night Shade, Seismic Toss, etc. don't count:
					if (!counter.damagingMoves[0].damage && (movePool.length - availableHP || availableHP && (damagingid === 'hiddenpower' || !hasMove['hiddenpower']))) {
						var replace = false;
						if (damagingid in {counter:1, focuspunch:1, mirrorcoat:1, suckerpunch:1} || (damagingid === 'hiddenpower' && !counter.stab)) {
							// Unacceptable as the only attacking move
							replace = true;
						} else {
							if (!counter.stab) {
								var damagingType = counter.damagingMoves[0].type;
								if (damagingType === 'Fairy') {
									// Mono-Fairy is acceptable for Psychic types
									if (!hasType['Psychic']) replace = true;
								} else if (damagingType === 'Ice') {
									if (hasType['Normal'] && template.types.length === 1) {
										// Mono-Ice is acceptable for special attacking Normal types that lack Boomburst and Hyper Voice
										if (counter.Physical >= 2 || movePool.indexOf('boomburst') >= 0 || movePool.indexOf('hypervoice') >= 0) replace = true;
									} else {
										replace = true;
									}
								} else {
									replace = true;
								}
							}
						}
						if (replace) moves.splice(counter.damagingMoveIndex[damagingid], 1);
					}
				} else if (counter.damagingMoves.length === 2 && !counter.stab) {
					// If you have two attacks, neither is STAB, and the combo isn't Ice/Electric or Ghost/Fighting, reject one of them at random.
					var type1 = counter.damagingMoves[0].type, type2 = counter.damagingMoves[1].type;
					var typeCombo = [type1, type2].sort().join('/');
					if (typeCombo !== 'Electric/Ice' && typeCombo !== 'Fighting/Ghost') {
						var rejectableMoves = [];
						var baseDiff = movePool.length - availableHP;
						if (baseDiff || availableHP && (!hasMove['hiddenpower'] || counter.damagingMoves[0].id === 'hiddenpower')) {
							rejectableMoves.push(counter.damagingMoveIndex[counter.damagingMoves[0].id]);
						}
						if (baseDiff || availableHP && (!hasMove['hiddenpower'] || counter.damagingMoves[1].id === 'hiddenpower')) {
							rejectableMoves.push(counter.damagingMoveIndex[counter.damagingMoves[1].id]);
						}
						if (rejectableMoves.length) {
							moves.splice(rejectableMoves[this.random(rejectableMoves.length)], 1);
						}
					}
				} else if (!counter.stab || ((hasAbility['Aerilate'] || hasAbility['Pixilate'] || hasAbility['Refrigerate']) && !counter['ate'])) {
					// If you have three or more attacks, and none of them are STAB, reject one of them at random.
					// Alternatively, if you have an -ate ability and no Normal moves, reject an attack move at random.
					var rejectableMoves = [];
					var baseDiff = movePool.length - availableHP;
					for (var l = 0; l < counter.damagingMoves.length; l++) {
						if (baseDiff || availableHP && (!hasMove['hiddenpower'] || counter.damagingMoves[l].id === 'hiddenpower')) {
							rejectableMoves.push(counter.damagingMoveIndex[counter.damagingMoves[l].id]);
						}
					}
					if (rejectableMoves.length) {
						moves.splice(rejectableMoves[this.random(rejectableMoves.length)], 1);
					}
				}
			}
		} while (moves.length < 4 && movePool.length);

		// any moveset modification goes here
		//moves[0] = 'safeguard';
		var changedMove = false;
		if (template.requiredItem && template.requiredItem.slice(-5) === 'Drive' && !hasMove['technoblast']) {
			delete hasMove[this.getMove(moves[3]).id];
			moves[3] = 'technoblast';
			hasMove['technoblast'] = true;
			changedMove = true;
		}
		if (template.id === 'meloettapirouette' && !hasMove['relicsong']) {
			delete hasMove[this.getMove(moves[3]).id];
			moves[3] = 'relicsong';
			hasMove['relicsong'] = true;
			changedMove = true;
		}
		if (template.requiredMove && !hasMove[toId(template.requiredMove)]) {
			delete hasMove[this.getMove(moves[3]).id];
			moves[3] = toId(template.requiredMove);
			hasMove[toId(template.requiredMove)] = true;
			changedMove = true;
		}

		// Re-query in case a moveset modification occurred
		if (changedMove) counter = this.queryMoves(moves, hasType, hasAbility);

		// If Hidden Power has been removed, reset the IVs
		if (!hasMove['hiddenpower']) {
			ivs = {
				hp: 31,
				atk: 31,
				def: 31,
				spa: 31,
				spd: 31,
				spe: 31
			};
		}

		var abilities = Object.values(baseTemplate.abilities).sort(function (a, b) {
			return this.getAbility(b).rating - this.getAbility(a).rating;
		}.bind(this));
		var ability0 = this.getAbility(abilities[0]);
		var ability1 = this.getAbility(abilities[1]);
		var ability2 = this.getAbility(abilities[2]);
		var ability = ability0.name;
		if (abilities[1]) {
			if (abilities[2] && ability2.rating === ability1.rating) {
				if (this.random(2)) ability1 = ability2;
			}
			if (ability0.rating <= ability1.rating) {
				if (this.random(2)) ability = ability1.name;
			} else if (ability0.rating - 0.6 <= ability1.rating) {
				if (!this.random(3)) ability = ability1.name;
			}

			var rejectAbility = false;
			if (ability in counterAbilities) {
				rejectAbility = !counter[toId(ability)];
			} else if (ability in ateAbilities) {
				rejectAbility = !counter['ate'];
			} else if (ability === 'Chlorophyll') {
				rejectAbility = !hasMove['sunnyday'];
			} else if (ability === 'Compound Eyes' || ability === 'No Guard') {
				rejectAbility = !counter['inaccurate'];
			} else if (ability === 'Defiant' || ability === 'Moxie') {
				rejectAbility = !counter['Physical'] && !hasMove['batonpass'];
			} else if (ability === 'Gluttony') {
				rejectAbility = true;
			} else if (ability === 'Limber') {
				rejectAbility = template.types.indexOf('Electric') >= 0;
			} else if (ability === 'Lightning Rod') {
				rejectAbility = template.types.indexOf('Ground') >= 0;
			} else if (ability === 'Moody') {
				rejectAbility = template.id !== 'bidoof';
			} else if (ability === 'Poison Heal') {
				rejectAbility = abilities.indexOf('Technician') >= 0 && !!counter['technician'];
			} else if (ability === 'Prankster') {
				rejectAbility = !counter['Status'];
			} else if (ability === 'Reckless' || ability === 'Rock Head') {
				rejectAbility = !counter['recoil'];
			} else if (ability === 'Serene Grace') {
				rejectAbility = !counter['serenegrace'] || template.id === 'chansey' || template.id === 'blissey';
			} else if (ability === 'Sheer Force') {
				rejectAbility = !counter['sheerforce'];
			} else if (ability === 'Simple') {
				rejectAbility = !counter.setupType && !hasMove['cosmicpower'] && !hasMove['flamecharge'];
			} else if (ability === 'Strong Jaw') {
				rejectAbility = !counter['bite'];
			} else if (ability === 'Sturdy') {
				rejectAbility = !!counter['recoil'] && !counter['recovery'];
			} else if (ability === 'Swift Swim') {
				rejectAbility = !hasMove['raindance'];
			} else if (ability === 'Unburden') {
				rejectAbility = template.baseStats.spe > 120 || (template.id === 'slurpuff' && !counter.setupType);
			}

			if (rejectAbility) {
				if (ability === ability1.name) { // or not
					ability = ability0.name;
				} else if (ability1.rating > 0) { // only switch if the alternative doesn't suck
					ability = ability1.name;
				}
			}
			if (abilities.indexOf('Chlorophyll') >= 0 && ability !== 'Solar Power') {
				ability = 'Chlorophyll';
			}
			if (abilities.indexOf('Guts') >= 0 && ability !== 'Quick Feet' && hasMove['facade']) {
				ability = 'Guts';
			}
			if (abilities.indexOf('Intimidate') >= 0 || template.id === 'mawilemega') {
				ability = 'Intimidate';
			}
			if (abilities.indexOf('Swift Swim') >= 0 && hasMove['raindance']) {
				ability = 'Swift Swim';
			}

			if (template.id === 'ambipom' && !counter['technician']) {
				// If it doesn't qualify for Technician, Skill Link is useless on it
				// Might as well give it Pickup just in case
				ability = 'Pickup';
			} else if (template.id === 'aurorus' && ability === 'Snow Warning' && hasMove['hypervoice']) {
				for (var i = 0; i < moves.length; i++) {
					if (moves[i] === 'hypervoice') {
						moves[i] = 'blizzard';
						counter['ate'] = 0;
						break;
					}
				}
			} else if (template.baseSpecies === 'Basculin') {
				ability = 'Adaptability';
			} else if (template.id === 'lilligant' && hasMove['petaldance']) {
				ability = 'Own Tempo';
			} else if (template.id === 'rhyperior') {
				ability = 'Solid Rock';
			} else if (template.id === 'unfezant') {
				ability = 'Super Luck';
			}
		}

		// Make EVs comply with the sets.
		// Quite simple right now, 252 attack, 252 hp if slow 252 speed if fast, 4 evs for the strong defense.
		// TO-DO: Make this more complex
		if (counter.Special >= 2) {
			evs.atk = 0;
			evs.spa = 252;
		} else if (counter.Physical >= 2) {
			evs.atk = 252;
			evs.spa = 0;
		} else {
			// Fallback in case a Pokémon lacks attacks... go by stats
			if (template.baseStats.spa >= template.baseStats.atk) {
				evs.atk = 0;
				evs.spa = 252;
			} else {
				evs.atk = 252;
				evs.spa = 0;
			}
		}
		if (template.baseStats.spe > 80 || template.species === 'Shedinja') {
			evs.spe = 252;
			evs.hp = 4;
		} else {
			evs.hp = 252;
			if (template.baseStats.def > template.baseStats.spd) {
				evs.def = 4;
			} else {
				evs.spd = 4;
			}
		}

		// Naturally slow mons already have the proper EVs, check IVs for Gyro Ball and TR
		if (hasMove['gyroball'] || hasMove['trickroom']) {
			ivs.spe = 0;
		}

		item = 'Sitrus Berry';
		if (template.requiredItem) {
			item = template.requiredItem;
		// First, the extra high-priority items
		} else if (ability === 'Imposter') {
			item = 'Choice Scarf';
		} else if (hasMove["magikarpsrevenge"]) {
			item = 'Mystic Water';
		} else if (ability === 'Wonder Guard') {
			item = 'Focus Sash';
		} else if (template.species === 'Unown') {
			item = 'Choice Specs';
		} else if (hasMove['trick'] || hasMove['switcheroo']) {
			var randomNum = this.random(2);
			if (counter.Physical >= 3 && (template.baseStats.spe >= 95 || randomNum)) {
				item = 'Choice Band';
			} else if (counter.Special >= 3 && (template.baseStats.spe >= 95 || randomNum)) {
				item = 'Choice Specs';
			} else {
				item = 'Choice Scarf';
			}
		} else if (hasMove['rest'] && !hasMove['sleeptalk'] && ability !== 'Natural Cure' && ability !== 'Shed Skin') {
			item = 'Chesto Berry';
		} else if (hasMove['naturalgift']) {
			item = 'Liechi Berry';
		} else if (hasMove['geomancy']) {
			item = 'Power Herb';
		} else if (ability === 'Harvest') {
			item = 'Sitrus Berry';
		} else if (template.species === 'Cubone' || template.species === 'Marowak') {
			item = 'Thick Club';
		} else if (template.baseSpecies === 'Pikachu') {
			item = 'Light Ball';
		} else if (template.species === 'Clamperl') {
			item = 'DeepSeaTooth';
		} else if (template.species === 'Spiritomb') {
			item = 'Leftovers';
		} else if (template.species === 'Scrafty' && counter['Status'] === 0) {
			item = 'Assault Vest';
		} else if (template.species === 'Farfetch\'d') {
			item = 'Stick';
		} else if (template.species === 'Amoonguss') {
			item = 'Black Sludge';
		} else if (template.species === 'Dedenne') {
			item = 'Petaya Berry';
		} else if (hasMove['focusenergy'] || (template.species === 'Unfezant' && counter['Physical'] >= 2)) {
			item = 'Scope Lens';
		} else if (template.evos.length) {
			item = 'Eviolite';
		} else if (hasMove['reflect'] && hasMove['lightscreen']) {
			item = 'Light Clay';
		} else if (hasMove['shellsmash']) {
			if (ability === 'Solid Rock' && counter['priority']) {
				item = 'Weakness Policy';
			} else {
				item = 'White Herb';
			}
		} else if (hasMove['facade'] || ability === 'Poison Heal' || ability === 'Toxic Boost') {
			item = 'Toxic Orb';
		} else if (hasMove['raindance']) {
			item = 'Damp Rock';
		} else if (hasMove['sunnyday']) {
			item = 'Heat Rock';
		} else if (hasMove['sandstorm']) {
			item = 'Smooth Rock';
		} else if (hasMove['hail']) {
			item = 'Icy Rock';
		} else if (ability === 'Magic Guard' && hasMove['psychoshift']) {
			item = 'Flame Orb';
		} else if (ability === 'Sheer Force' || ability === 'Magic Guard') {
			item = 'Life Orb';
		} else if (hasMove['acrobatics']) {
			item = 'Flying Gem';
		} else if (ability === 'Unburden') {
			if (hasMove['fakeout']) {
				item = 'Normal Gem';
			} else if (hasMove['dracometeor'] || hasMove['leafstorm'] || hasMove['overheat']) {
				item = 'White Herb';
			} else if (hasMove['substitute'] || counter.setupType) {
				item = 'Sitrus Berry';
			} else {
				item = 'Red Card';
				for (var m in moves) {
					var move = this.getMove(moves[m]);
					if (hasType[move.type] && move.basePower >= 90) {
						item = move.type + ' Gem';
						break;
					}
				}
			}

		// medium priority
		} else if (ability === 'Guts') {
			item = hasMove['drainpunch'] ? 'Flame Orb' : 'Toxic Orb';
			if ((hasMove['return'] || hasMove['hyperfang']) && !hasMove['facade']) {
				// lol no
				for (var j = 0; j < moves.length; j++) {
					if (moves[j] === 'Return' || moves[j] === 'Hyper Fang') {
						moves[j] = 'Facade';
						break;
					}
				}
			}
		} else if (ability === 'Marvel Scale' && hasMove['psychoshift']) {
			item = 'Flame Orb';
		} else if (counter.Physical >= 4 && template.baseStats.spe > 55 && !hasMove['fakeout'] && !hasMove['suckerpunch'] && !hasMove['flamecharge'] && !hasMove['rapidspin'] && ability !== 'Sturdy' && ability !== 'Multiscale') {
			item = 'Life Orb';
		} else if (counter.Special >= 4 && template.baseStats.spe > 55 && !hasMove['eruption'] && !hasMove['waterspout'] && ability !== 'Sturdy') {
			item = 'Life Orb';
		} else if (this.getImmunity('Ground', template) && this.getEffectiveness('Ground', template) >= 2 && ability !== 'Levitate' && !hasMove['magnetrise']) {
			item = 'Shuca Berry';
		} else if (this.getEffectiveness('Ice', template) >= 2) {
			item = 'Yache Berry';
		} else if (this.getEffectiveness('Rock', template) >= 2) {
			item = 'Charti Berry';
		} else if (this.getEffectiveness('Fire', template) >= 2) {
			item = 'Occa Berry';
		} else if (this.getImmunity('Fighting', template) && this.getEffectiveness('Fighting', template) >= 2) {
			item = 'Chople Berry';
		} else if (ability === 'Iron Barbs' || ability === 'Rough Skin') {
			item = 'Rocky Helmet';
		} else if (counter.Physical + counter.Special >= 4 && ability === 'Regenerator' && template.baseStats[counter.Special >= 2 ? 'atk' : 'spa'] > 99 && template.baseStats.spe <= 80) {
			item = 'Assault Vest';
		} else if ((template.baseStats.hp + 75) * (template.baseStats.def + template.baseStats.spd + 175) > 60000 || template.species === 'Skarmory' || template.species === 'Forretress') {
			// skarmory and forretress get exceptions for their typing
			item = 'Sitrus Berry';
		} else if (counter.Physical + counter.Special >= 3 && counter.setupType && ability !== 'Sturdy' && ability !== 'Multiscale') {
			item = 'Life Orb';
		} else if (counter.Special >= 3 && counter.setupType && ability !== 'Sturdy') {
			item = 'Life Orb';
		} else if (counter.Physical + counter.Special >= 4 && template.baseStats.def + template.baseStats.spd > 179) {
			item = 'Assault Vest';
		} else if (counter.Physical + counter.Special >= 4) {
			item = 'Expert Belt';
		} else if (hasMove['outrage']) {
			item = 'Lum Berry';
		} else if (hasMove['substitute'] || hasMove['detect'] || hasMove['protect'] || ability === 'Moody') {
			item = 'Leftovers';
		} else if (this.getImmunity('Ground', template) && this.getEffectiveness('Ground', template) >= 1 && ability !== 'Levitate' && !hasMove['magnetrise']) {
			item = 'Shuca Berry';
		} else if (this.getEffectiveness('Ice', template) >= 1) {
			item = 'Yache Berry';

		// this is the "REALLY can't think of a good item" cutoff
		} else if (counter.Physical + counter.Special >= 2 && template.baseStats.hp + template.baseStats.def + template.baseStats.spd > 315) {
			item = 'Weakness Policy';
		} else if (ability === 'Sturdy' && hasMove['explosion'] && !counter['speedsetup']) {
			item = 'Custap Berry';
		} else if (ability === 'Super Luck') {
			item = 'Scope Lens';
		} else if (hasType['Poison']) {
			item = 'Black Sludge';
		} else if (counter.Status <= 1 && ability !== 'Sturdy' && ability !== 'Multiscale') {
			item = 'Life Orb';
		} else {
			item = 'Sitrus Berry';
		}

		// For Trick / Switcheroo
		if (item === 'Leftovers' && hasType['Poison']) {
			item = 'Black Sludge';
		}

		// We choose level based on BST. Min level is 70, max level is 99. 600+ BST is 70, less than 300 is 99. Calculate with those values.
		// Every 10.34 BST adds a level from 70 up to 99. Results are floored. Uses the Mega's stats if holding a Mega Stone
		var bst = template.baseStats.hp + template.baseStats.atk + template.baseStats.def + template.baseStats.spa + template.baseStats.spd + template.baseStats.spe;
		// Adjust levels of mons based on abilities (Pure Power, Sheer Force, etc.) and also Eviolite
		// For the stat boosted, treat the Pokemon's base stat as if it were multiplied by the boost. (Actual effective base stats are higher.)
		var templateAbility = (baseTemplate === template ? ability : template.abilities[0]);
		if (templateAbility === 'Huge Power' || templateAbility === 'Pure Power') {
			bst += template.baseStats.atk;
		} else if (templateAbility === 'Parental Bond') {
			bst += 0.5 * (evs.atk > evs.spa ? template.baseStats.atk : template.baseStats.spa);
		} else if (templateAbility === 'Protean') {
			// Holistic judgment. Don't boost Protean as much as Parental Bond
			bst += 0.3 * (evs.atk > evs.spa ? template.baseStats.atk : template.baseStats.spa);
		} else if (templateAbility === 'Fur Coat') {
			bst += template.baseStats.def;
		}
		if (item === 'Eviolite') {
			bst += 0.5 * (template.baseStats.def + template.baseStats.spd);
		}
		var level = 70 + Math.floor(((600 - this.clampIntRange(bst, 300, 600)) / 10.34));

		return {
			name: name,
			moves: moves,
			ability: ability,
			evs: evs,
			ivs: ivs,
			item: item,
			level: level,
			shiny: !this.random(template.id === 'missingno' ? 4 : 1024)
		};
	},
	randomRainbowTeam: function () {
		var pokemonLeft = 0;
		var pokemon = [];

		var excludedTiers = {'LC':1, 'LC Uber':1, 'NFE':1};
		var allowedNFE = {'Chansey':1, 'Doublade':1, 'Gligar':1, 'Porygon2':1, 'Scyther':1};
		var excludedColors = {'Black':1, 'Brown':1, 'Gray':1, 'White':1};

		var pokemonPool = [];
		for (var id in this.data.FormatsData) {
			var template = this.getTemplate(id);
			if (!excludedTiers[template.tier] && !excludedColors[template.color] && !template.isMega && !template.isPrimal && !template.isNonstandard && template.randomBattleMoves) {
				pokemonPool.push(id);
			}
		}

		var typeCount = {};
		var typeComboCount = {};
		var colorCount = {};
		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var teamDetails = {megaCount: 0, stealthRock: 0};

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			// Useless in Random Battle without greatly lowering the levels of everything else
			if (template.species === 'Unown') continue;

			// Only certain NFE Pokemon are allowed
			if (template.evos.length && !allowedNFE[template.species]) continue;

			var tier = template.tier;
			switch (tier) {
			case 'PU':
				// PUs are limited to 2 but have a 20% chance of being added anyway.
				if (puCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'Uber':
				// Ubers are limited to 2 but have a 20% chance of being added anyway.
				if (uberCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(18) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Castform':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Pikachu is not a viable NFE Pokemon
				continue;
			}

			// Limit 2 of any type, 1 of any color
			var types = template.types;
			var colorGroups = {'Red': 'R', 'Pink': 'R', 'Yellow': 'G', 'Green': 'G', 'Blue': 'B', 'Purple': 'B'};
			var color = colorGroups[template.color];
			var skip = false;
			for (var t = 0; t < types.length; t++) {
				if (typeCount[types[t]] > 1 && this.random(5) >= 1) {
					skip = true;
					break;
				}
			}
			if (colorCount[color] > 1 && this.random(8) >= 1) {
				skip = true;
			}
			if (skip) continue;

			var set = this.randomSet(template, pokemon.length, teamDetails);

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit 1 of any type combination
			var typeCombo = types.join();
			if (set.ability === 'Drought' || set.ability === 'Drizzle') {
				// Drought and Drizzle don't count towards the type combo limit
				typeCombo = set.ability;
			}
			if (typeCombo in typeComboCount) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && teamDetails.megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			if (template.species !== 'Ditto') set.moves.push('swift');
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment type and color counters
			for (var t = 0; t < types.length; t++) {
				if (types[t] in typeCount) {
					typeCount[types[t]]++;
				} else {
					typeCount[types[t]] = 1;
				}
			}
			typeComboCount[typeCombo] = 1;
			if (color in colorCount) {
				colorCount[color]++;
			} else {
				colorCount[color] = 1;
			}

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU') {
				puCount++;
			}

			// Increment mega, stealthrock, and base species counters
			if (isMegaSet) teamDetails.megaCount++;
			if (set.moves.indexOf('stealthrock') >= 0) teamDetails.stealthRock++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	},
	randomFactorySets: require('./factory-sets.json'),
	randomFactorySet: function (template, slot, teamData, tier) {
		var speciesId = toId(template.species);
		var flags = this.randomFactorySets[tier][speciesId].flags;
		var setList = this.randomFactorySets[tier][speciesId].sets;
		var effectivePool, priorityPool;

		var itemsMax = {'choicespecs':1, 'choiceband':1, 'choicescarf':1};
		var movesMax = {'rapidspin':1, 'batonpass':1, 'stealthrock':1, 'defog':1, 'spikes':1, 'toxicspikes':1};
		var requiredMoves = {'stealthrock': 'hazardSet', 'rapidspin': 'hazardClear', 'defog': 'hazardClear'};
		var weatherAbilitiesRequire = {
			'hydration': 'raindance', 'swiftswim': 'raindance',
			'leafguard': 'sunnyday', 'solarpower': 'sunnyday', 'chlorophyll': 'sunnyday',
			'sandforce': 'sandstorm', 'sandrush': 'sandstorm', 'sandveil': 'sandstorm',
			'snowcloak': 'hail'
		};
		var weatherAbilitiesSet = {'drizzle':1, 'drought':1, 'snowwarning':1, 'sandstream':1};

		// Build a pool of eligible sets, given the team partners
		// Also keep track of sets with moves the team requires
		effectivePool = [];
		priorityPool = [];
		for (var i = 0, l = setList.length; i < l; i++) {
			var curSet = setList[i];
			var itemData = this.getItem(curSet.item);
			if (teamData.megaCount > 0 && itemData.megaStone) continue; // reject 2+ mega stones
			if (itemsMax[itemData.id] && teamData.has[itemData.id] >= itemsMax[itemData.id]) continue;

			var abilityData = this.getAbility(curSet.ability);
			if (weatherAbilitiesRequire[abilityData.id] && teamData.weather !== weatherAbilitiesRequire[abilityData.id]) continue;
			if (teamData.weather && weatherAbilitiesSet[abilityData.id]) continue; // reject 2+ weather setters

			var reject = false;
			var hasRequiredMove = false;
			var curSetVariants = [];
			for (var j = 0, m = curSet.moves.length; j < m; j++) {
				var variantIndex = this.random(curSet.moves[j].length);
				var moveId = toId(curSet.moves[j][variantIndex]);
				if (movesMax[moveId] && teamData.has[moveId] >= movesMax[moveId]) {
					reject = true;
					break;
				}
				if (requiredMoves[moveId] && !teamData.has[requiredMoves[moveId]]) {
					hasRequiredMove = true;
				}
				curSetVariants.push(variantIndex);
			}
			if (reject) continue;
			effectivePool.push({set: curSet, moveVariants: curSetVariants});
			if (hasRequiredMove) priorityPool.push({set: curSet, moveVariants: curSetVariants});
		}
		if (priorityPool.length) effectivePool = priorityPool;

		if (!effectivePool.length) {
			if (!teamData.forceResult) return false;
			for (var i = 0; i < setList.length; i++) {
				effectivePool.push({set: setList[i]});
			}
		}

		var setData = effectivePool[this.random(effectivePool.length)];
		var moves = [];
		for (var i = 0; i < setData.set.moves.length; i++) {
			var moveSlot = setData.set.moves[i];
			moves.push(setData.moveVariants ? moveSlot[setData.moveVariants[i]] : moveSlot[this.random(moveSlot.length)]);
		}

		return {
			name: setData.set.name || setData.set.species,
			species: setData.set.species,
			gender: setData.set.gender || template.gender || (this.random() ? 'M' : 'F'),
			item: setData.set.item || '',
			ability: setData.set.ability || template.abilities['0'],
			shiny: typeof setData.set.shiny === 'undefined' ? !this.random(1024) : setData.set.shiny,
			level: 100,
			happiness: typeof setData.set.happiness === 'undefined' ? 255 : setData.set.happiness,
			evs: setData.set.evs || {hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84},
			ivs: setData.set.ivs || {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31},
			nature: setData.set.nature || 'Serious',
			moves: moves
		};
	},
	randomFactoryTeam: function (side, depth) {
		if (!depth) depth = 0;
		var forceResult = (depth >= 4);

		var availableTiers = ['Uber', 'OU', 'UU', 'RU', 'NU'];
		var chosenTier;

		var currentSeed = this.seed.slice();
		this.seed = this.startingSeed.slice();
		chosenTier = availableTiers[this.random(availableTiers.length)];
		this.seed = currentSeed;

		var pokemonLeft = 0;
		var pokemon = [];

		var pokemonPool = Object.keys(this.randomFactorySets[chosenTier]);

		var teamData = {typeCount: {}, typeComboCount: {}, baseFormes: {}, megaCount: 0, has: {}, forceResult: forceResult, weaknesses: {}, resistances: {}};
		var requiredMoveFamilies = {'hazardSet': 1, 'hazardClear':1};
		var requiredMoves = {'stealthrock': 'hazardSet', 'rapidspin': 'hazardClear', 'defog': 'hazardClear'};
		var weatherAbilitiesSet = {'drizzle': 'raindance', 'drought': 'sunnyday', 'snowwarning': 'hail', 'sandstream': 'sandstorm'};
		var resistanceAbilities = {
			'dryskin': ['Water'], 'waterabsorb': ['Water'], 'stormdrain': ['Water'],
			'flashfire': ['Fire'], 'heatproof': ['Fire'],
			'lightningrod': ['Electric'], 'motordrive': ['Electric'], 'voltabsorb': ['Electric'],
			'sapsipper': ['Grass'],
			'thickfat': ['Ice', 'Fire'],
			'levitate': ['Ground']
		};

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			var speciesFlags = this.randomFactorySets[chosenTier][template.speciesid].flags;

			// Limit to one of each species (Species Clause)
			if (teamData.baseFormes[template.baseSpecies]) continue;

			// Limit the number of Megas to one
			if (teamData.megaCount >= 1 && speciesFlags.megaOnly) continue;

			// Limit 2 of any type
			var types = template.types;
			var skip = false;
			for (var t = 0; t < types.length; t++) {
				if (teamData.typeCount[types[t]] > 1 && this.random(5)) {
					skip = true;
					break;
				}
			}
			if (skip) continue;

			var set = this.randomFactorySet(template, pokemon.length, teamData, chosenTier);
			if (!set) continue;

			// Limit 1 of any type combination
			var typeCombo = types.slice().sort().join();
			if (set.ability === 'Drought' || set.ability === 'Drizzle') {
				// Drought and Drizzle don't count towards the type combo limit
				typeCombo = set.ability;
			}
			if (typeCombo in teamData.typeComboCount) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);
			pokemonLeft++;

			// Now that our Pokemon has passed all checks, we can update team data:
			for (var t = 0; t < types.length; t++) {
				if (types[t] in teamData.typeCount) {
					teamData.typeCount[types[t]]++;
				} else {
					teamData.typeCount[types[t]] = 1;
				}
			}
			teamData.typeComboCount[typeCombo] = 1;

			teamData.baseFormes[template.baseSpecies] = 1;

			var itemData = this.getItem(set.item);
			if (itemData.megaStone) teamData.megaCount++;
			if (itemData.id in teamData.has) {
				teamData.has[itemData.id]++;
			} else {
				teamData.has[itemData.id] = 1;
			}

			var abilityData = this.getAbility(set.ability);
			if (abilityData.id in weatherAbilitiesSet) {
				teamData.weather = weatherAbilitiesSet[abilityData.id];
			}

			for (var m = 0; m < set.moves.length; m++) {
				var moveId = toId(set.moves[m]);
				if (moveId in teamData.has) {
					teamData.has[moveId]++;
				} else {
					teamData.has[moveId] = 1;
				}
				if (moveId in requiredMoves) {
					teamData.has[requiredMoves[moveId]] = 1;
				}
			}

			for (var typeName in this.data.TypeChart) {
				// Cover any major weakness (3+) with at least one resistance
				if (teamData.resistances[typeName] >= 1) continue;
				if (resistanceAbilities[abilityData.id] && resistanceAbilities[abilityData.id].indexOf(typeName) >= 0 || !this.getImmunity(typeName, types)) {
					// Heuristic: assume that Pokémon with these abilities don't have (too) negative typing.
					teamData.resistances[typeName] = (teamData.resistances[typeName] || 0) + 1;
					if (teamData.resistances[typeName] >= 1) teamData.weaknesses[typeName] = 0;
					continue;
				}
				var typeMod = this.getEffectiveness(typeName, types);
				if (typeMod < 0) {
					teamData.resistances[typeName] = (teamData.resistances[typeName] || 0) + 1;
					if (teamData.resistances[typeName] >= 1) teamData.weaknesses[typeName] = 0;
				} else if (typeMod > 0) {
					teamData.weaknesses[typeName] = (teamData.weaknesses[typeName] || 0) + 1;
				}
			}
		}
		if (pokemon.length < 6) return this.randomFactoryTeam(side, ++depth);

		// Quality control
		if (!teamData.forceResult) {
			for (var requiredFamily in requiredMoveFamilies) {
				if (!teamData.has[requiredFamily]) return this.randomFactoryTeam(side, ++depth);
			}
			for (var type in teamData.weaknesses) {
				if (teamData.weaknesses[type] >= 3) return this.randomFactoryTeam(side, ++depth);
			}
		}

		return pokemon;
	},
	randomMonotypeTeam: function (side) {
		var pokemonLeft = 0;
		var pokemon = [];
		var typePool = Object.keys(this.data.TypeChart);
		var type = typePool[this.random(typePool.length)];

		var pokemonPool = [];
		for (var id in this.data.FormatsData) {
			var template = this.getTemplate(id);
			var types = template.types;
			if (template.baseSpecies === 'Castform') types = ['Normal'];
			if (template.speciesid === 'meloettapirouette') types = ['Normal', 'Psychic'];
			if (types.indexOf(type) >= 0 && !template.isMega && !template.isPrimal && !template.isNonstandard && template.randomBattleMoves) {
				pokemonPool.push(id);
			}
		}

		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var megaCount = 0;

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			var tier = template.tier;
			switch (tier) {
			case 'LC':
			case 'LC Uber':
			case 'NFE':
				if (puCount > 1) continue;
				break;
			case 'PU':
				// PUs are limited to 2 but have a 20% chance of being added anyway.
				if (puCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'Uber':
				// Ubers are limited to 2 but have a 20% chance of being added anyway.
				if (uberCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(18) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Pumpkaboo':
				if (this.random(4) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Cosplay Pikachu formes have 20% the normal rate (1/30 the normal rate each)
				if (template.species !== 'Pikachu' && this.random(30) >= 1) continue;
			}

			var set = this.randomSet(template, pokemon.length, megaCount);

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU' || tier === 'LC' || tier === 'LC Uber' || tier === 'NFE') {
				puCount++;
			}

			// Increment mega and base species counters
			if (isMegaSet) megaCount++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	},
	randomNoPotDTeam: function (side) {
		var pokemonLeft = 0;
		var pokemon = [];

		var pokemonPool = [];
		for (var id in this.data.FormatsData) {
			var template = this.getTemplate(id);
			if (!template.isMega && !template.isPrimal && !template.isNonstandard && template.randomBattleMoves) {
				pokemonPool.push(id);
			}
		}

		var typeCount = {};
		var typeComboCount = {};
		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var megaCount = 0;

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			var tier = template.tier;
			switch (tier) {
			case 'LC':
			case 'LC Uber':
			case 'NFE':
				if (puCount > 1) continue;
				break;
			case 'PU':
				// PUs are limited to 2 but have a 20% chance of being added anyway.
				if (puCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'Uber':
				// Ubers are limited to 2 but have a 20% chance of being added anyway.
				if (uberCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(18) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Pumpkaboo':
				if (this.random(4) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Castform':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Cosplay Pikachu formes have 20% the normal rate (1/30 the normal rate each)
				if (template.species !== 'Pikachu' && this.random(30) >= 1) continue;
			}

			// Limit 2 of any type
			var types = template.types;
			var skip = false;
			for (var t = 0; t < types.length; t++) {
				if (typeCount[types[t]] > 1 && this.random(5) >= 1) {
					skip = true;
					break;
				}
			}
			if (skip) continue;

			var set = this.randomSet(template, pokemon.length, megaCount);

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit 1 of any type combination
			var typeCombo = types.join();
			if (set.ability === 'Drought' || set.ability === 'Drizzle') {
				// Drought and Drizzle don't count towards the type combo limit
				typeCombo = set.ability;
			}
			if (typeCombo in typeComboCount) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment type counters
			for (var t = 0; t < types.length; t++) {
				if (types[t] in typeCount) {
					typeCount[types[t]]++;
				} else {
					typeCount[types[t]] = 1;
				}
			}
			typeComboCount[typeCombo] = 1;

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU' || tier === 'LC' || tier === 'LC Uber' || tier === 'NFE') {
				puCount++;
			}

			// Increment mega and base species counters
			if (isMegaSet) megaCount++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	},
	randomUberTeam: function (side) {
		var pokemonLeft = 0;
		var pokemon = [];

		var pokemonPool = ['aegislash', 'arceus', 'arceusbug', 'arceusdark', 'arceusdragon', 'arceuselectric', 'arceusfairy', 'arceusfighting', 'arceusfire', 'arceusflying', 'arceusghost', 'arceusgrass', 'arceusground', 'arceusice', 'arceuspoison', 'arceuspsychic', 'arceusrock', 'arceussteel', 'arceuswater', 'blaziken', 'darkrai', 'deoxys', 'deoxysattack', 'deoxysdefense', 'deoxysspeed', 'dialga', 'genesect', 'gengar', 'giratina', 'giratinaorigin', 'greninja', 'groudon', 'hooh', 'kangaskhan', 'kyogre', 'kyuremwhite', 'lucario', 'lugia', 'mawile', 'mewtwo', 'palkia', 'rayquaza', 'reshiram', 'salamence', 'shayminsky', 'xerneas', 'yveltal', 'zekrom'];

		var typeCount = {};
		var typeComboCount = {};
		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var megaCount = 0;

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			var tier = template.tier;
			switch (tier) {
			case 'LC':
			case 'LC Uber':
			case 'NFE':
				if (puCount > 1) continue;
				break;
			case 'PU':
				// PUs are limited to 2 but have a 20% chance of being added anyway.
				if (puCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(18) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Pumpkaboo':
				if (this.random(4) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Castform':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Cosplay Pikachu formes have 20% the normal rate (1/30 the normal rate each)
				if (template.species !== 'Pikachu' && this.random(30) >= 1) continue;
			}

			// Limit 2 of any type
			var types = template.types;
			var skip = false;
			for (var t = 0; t < types.length; t++) {
				if (typeCount[types[t]] > 1 && this.random(5) >= 1) {
					skip = true;
					break;
				}
			}
			if (skip) continue;

			var set = this.randomSet(template, pokemon.length, megaCount);

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit 1 of any type combination
			var typeCombo = types.join();
			if (set.ability === 'Drought' || set.ability === 'Drizzle') {
				// Drought and Drizzle don't count towards the type combo limit
				typeCombo = set.ability;
			}
			if (typeCombo in typeComboCount) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment type counters
			for (var t = 0; t < types.length; t++) {
				if (types[t] in typeCount) {
					typeCount[types[t]]++;
				} else {
					typeCount[types[t]] = 1;
				}
			}
			typeComboCount[typeCombo] = 1;

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU' || tier === 'LC' || tier === 'LC Uber' || tier === 'NFE') {
				puCount++;
			}

			// Increment mega and base species counters
			if (isMegaSet) megaCount++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	},
	randomHighTierTeam: function (side) {
		var pokemonLeft = 0;
		var pokemon = [];

		var pokemonPool = ['altaria', 'azumarill', 'bisharp', 'breloom', 'celebi', 'chansey', 'charizard', 'clefable', 'conkeldurr', 'diancie', 'dragonite', 'excadrill', 'ferrothorn', 'gallade', 'garchomp', 'gardevoir', 'gengar', 'gliscor', 'gothitelle', 'gyarados', 'heatran', 'jirachi', 'keldeo', 'kyuremblack', 'landorus', 'landorustherian', 'latias', 'latios', 'lopunny', 'magnezone', 'mamoswine', 'manaphy', 'mandibuzz', 'manectric', 'metagross', 'mew', 'raikou', 'rotomwash', 'sableye', 'scizor', 'skarmory', 'slowbro', 'starmie', 'sylveon', 'talonflame', 'thundurus', 'tyranitar', 'venusaur', 'zapdos', 'crawdaunt', 'diggersby', 'hawlucha', 'klefki', 'medicham', 'scolipede', 'serperior', 'smeargle', 'staraptor', 'terrakion', 'thundurustherian', 'togekiss', 'tornadustherian', 'venomoth', 'victini', 'volcarona', 'weavile', 'zygarde', 'absol', 'aerodactyl', 'aggron', 'alakazam', 'ampharos', 'arcanine', 'azelf', 'beedrill', 'blastoise', 'blissey', 'chandelure', 'chesnaught', 'cloyster', 'crobat', 'darmanitan', 'donphan', 'empoleon', 'entei', 'espeon', 'florges', 'forretress', 'galvantula', 'gligar', 'goodra', 'haxorus', 'heracross', 'hippowdon', 'honchkrow', 'hydreigon', 'infernape', 'kingdra', 'krookodile', 'lucario', 'machamp', 'mienshao', 'milotic', 'nidoking', 'nidoqueen', 'pidgeot', 'pinsir', 'porygonz', 'porygon2', 'roserade', 'rotomheat', 'salamence', 'sceptile', 'sharpedo', 'shaymin', 'snorlax', 'suicune', 'swampert', 'tentacruel', 'toxicroak', 'trevenant', 'umbreon', 'vaporeon', 'dragalge', 'froslass', 'houndoom', 'kyurem', 'shuckle', 'tornadus', 'yanmega', 'zoroark', 'heliolisk', 'slurpuff', 'abomasnow', 'doublade', 'cresselia', 'slowking', 'whimsicott', 'moltres', 'pangoro', 'feraligatr', 'noivern', 'hoopa', 'hoopaunbound'];

		var typeCount = {};
		var typeComboCount = {};
		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var megaCount = 0;

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			var tier = template.tier;
			switch (tier) {
			case 'LC':
			case 'LC Uber':
			case 'NFE':
				if (puCount > 1) continue;
				break;
			case 'PU':
				// PUs are limited to 2 but have a 20% chance of being added anyway.
				if (puCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'Uber':
				// Ubers are limited to 2 but have a 20% chance of being added anyway.
				if (uberCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(18) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Pumpkaboo':
				if (this.random(4) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Castform':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Cosplay Pikachu formes have 20% the normal rate (1/30 the normal rate each)
				if (template.species !== 'Pikachu' && this.random(30) >= 1) continue;
			}

			// Limit 2 of any type
			var types = template.types;
			var skip = false;
			for (var t = 0; t < types.length; t++) {
				if (typeCount[types[t]] > 1 && this.random(5) >= 1) {
					skip = true;
					break;
				}
			}
			if (skip) continue;

			var set = this.randomSet(template, pokemon.length, megaCount);

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit 1 of any type combination
			var typeCombo = types.join();
			if (set.ability === 'Drought' || set.ability === 'Drizzle') {
				// Drought and Drizzle don't count towards the type combo limit
				typeCombo = set.ability;
			}
			if (typeCombo in typeComboCount) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment type counters
			for (var t = 0; t < types.length; t++) {
				if (types[t] in typeCount) {
					typeCount[types[t]]++;
				} else {
					typeCount[types[t]] = 1;
				}
			}
			typeComboCount[typeCombo] = 1;

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU' || tier === 'LC' || tier === 'LC Uber' || tier === 'NFE') {
				puCount++;
			}

			// Increment mega and base species counters
			if (isMegaSet) megaCount++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	},
	randomLowTierTeam: function (side) {
		var pokemonLeft = 0;
		var pokemon = [];

		var pokemonPool = ['accelgor', 'alomomola', 'ambipom', 'amoonguss', 'aromatisse', 'banette', 'braviary', 'bronzong', 'cinccino', 'clawitzer', 'cobalion', 'cofagrigus', 'delphox', 'drapion', 'druddigon', 'dugtrio', 'durant', 'eelektross', 'emboar', 'escavalier', 'exploud', 'fletchinder', 'gastrodon', 'glalie', 'golbat', 'hitmonchan', 'hitmonlee', 'hitmontop', 'houndoom', 'jellicent', 'jolteon', 'kabutops', 'magneton', 'medicham', 'meloetta', 'omastar', 'registeel', 'reuniclus', 'rhyperior', 'rotommow', 'shiftry', 'skuntank', 'spiritomb', 'tangrowth', 'tyrantrum', 'combusken', 'sigilyph', 'arbok', 'archeops', 'ariados', 'armaldo', 'articuno', 'audino', 'aurorus', 'avalugg', 'barbaracle', 'basculin', 'basculinbluestriped', 'bastiodon', 'beartic', 'beautifly', 'beheeyem', 'bellossom', 'bibarel', 'bouffalant', 'butterfree', 'cacturne', 'camerupt', 'carbink', 'carnivine', 'carracosta', 'castformsunny', 'castformrainy', 'chatot', 'cherrim', 'chimecho', 'claydol', 'corsola', 'cradily', 'crustle', 'cryogonal', 'dedenne', 'delcatty', 'delibird', 'dewgong', 'ditto', 'dodrio', 'dragonair', 'drifblim', 'dunsparce', 'duosion', 'dusclops', 'dusknoir', 'dustox', 'electivire', 'electrode', 'emolga', 'exeggutor', 'farfetchd', 'fearow', 'ferroseed', 'flareon', 'floatzel', 'floette', 'fraxure', 'frogadier', 'furfrou', 'furret', 'gabite', 'garbodor', 'gigalith', 'girafarig', 'glaceon', 'gogoat', 'golduck', 'golem', 'golurk', 'gorebyss', 'gourgeist', 'gourgeistlarge', 'gourgeistsmall', 'gourgeistsuper', 'granbull', 'grumpig', 'gurdurr', 'hariyama', 'haunter', 'heatmor', 'huntail', 'hypno', 'illumise', 'jumpluff', 'jynx', 'kadabra', 'kangaskhan', 'kecleon', 'kingler', 'klinklang', 'kricketune', 'lampent', 'lanturn', 'lapras', 'leafeon', 'leavanny', 'ledian', 'lickilicky', 'liepard', 'lilligant', 'linoone', 'ludicolo', 'lumineon', 'lunatone', 'luvdisc', 'luxray', 'machoke', 'magcargo', 'magmortar', 'malamar', 'mantine', 'maractus', 'marowak', 'masquerain', 'mawile', 'meganium', 'meowsticf', 'meowstic', 'mesprit', 'metang', 'mightyena', 'miltank', 'minun', 'misdreavus', 'mismagius', 'mothim', 'mrmime', 'muk', 'murkrow', 'musharna', 'ninetales', 'ninjask', 'noctowl', 'octillery', 'pachirisu', 'parasect', 'pelipper', 'persian', 'phione', 'pikachu', 'pikachucosplay', 'pikachurockstar', 'pikachubelle', 'pikachupopstar', 'pikachuphd', 'pikachulibre', 'piloswine', 'plusle', 'politoed', 'poliwrath', 'primeape', 'probopass', 'purugly', 'pyroar', 'quagsire', 'quilladin', 'qwilfish', 'raichu', 'rampardos', 'rapidash', 'raticate', 'regice', 'regigigas', 'regirock', 'relicanth', 'rhydon', 'roselia', 'rotom', 'rotomfan', 'rotomfrost', 'samurott', 'sandslash', 'sawk', 'sawsbuck', 'scyther', 'seadra', 'seaking', 'seismitoad', 'seviper', 'shedinja', 'shelgon', 'simipour', 'simisage', 'simisear', 'slaking', 'sliggoo', 'sneasel', 'solrock', 'spinda', 'stantler', 'steelix', 'stoutland', 'stunfisk', 'sudowoodo', 'sunflora', 'swalot', 'swanna', 'swellow', 'swoobat', 'tangela', 'tauros', 'throh', 'togetic', 'torkoal', 'torterra', 'tropius', 'typhlosion', 'unfezant', 'unown', 'ursaring', 'uxie', 'vanilluxe', 'vespiquen', 'victreebel', 'vigoroth', 'vileplume', 'virizion', 'vivillon', 'volbeat', 'wailord', 'walrein', 'watchog', 'weezing', 'whiscash', 'wigglytuff', 'wobbuffet', 'wormadam', 'wormadamsandy', 'wormadamtrash', 'xatu', 'zangoose', 'zebstrika', 'scrafty', 'gallade', 'flygon', 'pinsir', 'pawniard'];

		var typeCount = {};
		var typeComboCount = {};
		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var megaCount = 0;

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			var tier = template.tier;
			switch (tier) {
			case 'LC':
			case 'LC Uber':
			case 'NFE':
				if (puCount > 1) continue;
				break;
			case 'PU':
				// PUs are limited to 2 but have a 20% chance of being added anyway.
				if (puCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'Uber':
				// Ubers are limited to 2 but have a 20% chance of being added anyway.
				if (uberCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(18) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Pumpkaboo':
				if (this.random(4) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Castform':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Cosplay Pikachu formes have 20% the normal rate (1/30 the normal rate each)
				if (template.species !== 'Pikachu' && this.random(30) >= 1) continue;
			}

			// Limit 2 of any type
			var types = template.types;
			var skip = false;
			for (var t = 0; t < types.length; t++) {
				if (typeCount[types[t]] > 1 && this.random(5) >= 1) {
					skip = true;
					break;
				}
			}
			if (skip) continue;

			var set = this.randomSet(template, pokemon.length, megaCount);

			if (template.id === 'wobbuffet') {
				set.species = 'Wobbuffet';
				set.ability = 'Telepathy';
			} else if (template.id === 'ninetales') {
				set.species = 'Ninetales';
				set.ability = 'Flash Fire';
			} else if (template.id === 'politoed') {
				set.species = 'Politoed';
				set.ability = 'Water Absorb';
			}

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit 1 of any type combination
			var typeCombo = types.join();
			if (set.ability === 'Drought' || set.ability === 'Drizzle') {
				// Drought and Drizzle don't count towards the type combo limit
				typeCombo = set.ability;
			}
			if (typeCombo in typeComboCount) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment type counters
			for (var t = 0; t < types.length; t++) {
				if (types[t] in typeCount) {
					typeCount[types[t]]++;
				} else {
					typeCount[types[t]] = 1;
				}
			}
			typeComboCount[typeCombo] = 1;

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU' || tier === 'LC' || tier === 'LC Uber' || tier === 'NFE') {
				puCount++;
			}

			// Increment mega and base species counters
			if (isMegaSet) megaCount++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	},
	randomLCTeam: function (side) {
		var pokemonLeft = 0;
		var pokemon = [];

		var pokemonPool = ['abra', 'aipom', 'amaura', 'anorith', 'archen', 'aron', 'axew', 'azurill', 'bagon', 'baltoy', 'barboach', 'beldum', 'bellsprout', 'bergmite', 'bidoof', 'binacle', 'blitzle', 'bonsly', 'bronzor', 'budew', 'buizel', 'bulbasaur', 'buneary', 'bunnelby', 'burmy', 'cacnea', 'carvanha', 'caterpie', 'charmander', 'cherubi', 'chespin', 'chikorita', 'chimchar', 'chinchou', 'chingling', 'clamperl', 'clauncher', 'cleffa', 'combee', 'corphish', 'cottonee', 'cranidos', 'croagunk', 'cubchoo', 'cubone', 'cyndaquil', 'darumaka', 'deerling', 'deino', 'diglett', 'doduo', 'dratini', 'drifloon', 'drilbur', 'drowzee', 'ducklett', 'duskull', 'dwebble', 'eevee', 'ekans', 'electrike', 'elekid', 'elgyem', 'espurr', 'exeggcute', 'feebas', 'fennekin', 'ferroseed', 'finneon', 'flabebe', 'fletchling', 'foongus', 'frillish', 'froakie', 'gastly', 'geodude', 'gible', 'glameow', 'goldeen', 'golett', 'goomy', 'gothita', 'grimer', 'growlithe', 'gulpin', 'happiny', 'helioptile', 'hippopotas', 'honedge', 'hoothoot', 'hoppip', 'horsea', 'houndour', 'igglybuff', 'inkay', 'joltik', 'kabuto', 'karrablast', 'klink', 'koffing', 'krabby', 'kricketot', 'larvesta', 'larvitar', 'ledyba', 'lickitung', 'lileep', 'lillipup', 'litleo', 'litwick', 'lotad', 'machop', 'magby', 'magikarp', 'magnemite', 'makuhita', 'mankey', 'mantyke', 'mareep', 'meowth', 'mienfoo', 'mimejr', 'minccino', 'mudkip', 'munchlax', 'munna', 'natu', 'nidoranf', 'nidoranm', 'nincada', 'noibat', 'nosepass', 'numel', 'oddish', 'omanyte', 'onix', 'oshawott', 'pancham', 'panpour', 'pansage', 'pansear', 'paras', 'patrat', 'pawniard', 'petilil', 'phanpy', 'phantump', 'pichu', 'pidgey', 'pidove', 'pineco', 'piplup', 'poliwag', 'ponyta', 'poochyena', 'porygon', 'psyduck', 'pumpkaboo', 'pumpkaboolarge', 'pumpkaboosmall', 'pumpkaboosuper', 'purrloin', 'ralts', 'rattata', 'remoraid', 'rhyhorn', 'riolu', 'roggenrola', 'rufflet', 'sandile', 'sandshrew', 'scatterbug', 'scraggy', 'seedot', 'seel', 'sentret', 'sewaddle', 'shellder', 'shellos', 'shelmet', 'shieldon', 'shinx', 'shroomish', 'shuppet', 'skiddo', 'skitty', 'skorupi', 'skrelp', 'slakoth', 'slowpoke', 'slugma', 'smoochum', 'snivy', 'snorunt', 'snover', 'snubbull', 'solosis', 'spearow', 'spheal', 'spinarak', 'spoink', 'spritzee', 'squirtle', 'starly', 'staryu', 'stunky', 'sunkern', 'surskit', 'swablu', 'swinub', 'taillow', 'teddiursa', 'tentacool', 'tepig', 'timburr', 'tirtouga', 'togepi', 'torchic', 'totodile', 'trapinch', 'treecko', 'trubbish', 'turtwig', 'tympole', 'tynamo', 'tyrogue', 'tyrunt', 'vanillite', 'venipede', 'venonat', 'voltorb', 'vullaby', 'wailmer', 'weedle', 'whismur', 'wingull', 'woobat', 'wooper', 'wurmple', 'wynaut', 'yamask', 'zigzagoon', 'zorua', 'zubat'];

		var typeCount = {};
		var typeComboCount = {};
		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var megaCount = 0;

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			var tier = template.tier;
			switch (tier) {
			case 'NFE':
				if (puCount > 1) continue;
				break;
			case 'PU':
				// PUs are limited to 2 but have a 20% chance of being added anyway.
				if (puCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'Uber':
				// Ubers are limited to 2 but have a 20% chance of being added anyway.
				if (uberCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(18) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Pumpkaboo':
				if (this.random(4) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Castform':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Cosplay Pikachu formes have 20% the normal rate (1/30 the normal rate each)
				if (template.species !== 'Pikachu' && this.random(30) >= 1) continue;
			}

			// Limit 2 of any type
			var types = template.types;
			var skip = false;
			for (var t = 0; t < types.length; t++) {
				if (typeCount[types[t]] > 1 && this.random(5) >= 1) {
					skip = true;
					break;
				}
			}
			if (skip) continue;

			var set = this.randomSet(template, pokemon.length, megaCount);

			set.level = 5;

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit 1 of any type combination
			var typeCombo = types.join();
			if (set.ability === 'Drought' || set.ability === 'Drizzle') {
				// Drought and Drizzle don't count towards the type combo limit
				typeCombo = set.ability;
			}
			if (typeCombo in typeComboCount) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment type counters
			for (var t = 0; t < types.length; t++) {
				if (types[t] in typeCount) {
					typeCount[types[t]]++;
				} else {
					typeCount[types[t]] = 1;
				}
			}
			typeComboCount[typeCombo] = 1;

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU' || tier === 'LC' || tier === 'LC Uber' || tier === 'NFE') {
				puCount++;
			}

			// Increment mega and base species counters
			if (isMegaSet) megaCount++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	},
	randomGenerationalTeam: function (side) {
		var pokemonLeft = 0;
		var pokemon = [];

		var kantoPool = ['venusaur', 'charizard', 'blastoise', 'butterfree', 'beedrill', 'pidgeot', 'raticate', 'fearow', 'arbok', 'raichu', 'sandslash', 'nidoqueen', 'nidoking', 'clefable', 'ninetales', 'wigglytuff', 'golbat', 'vileplume', 'parasect', 'venomoth', 'dugtrio', 'persian', 'golduck', 'primeape', 'arcanine', 'poliwrath', 'alakazam', 'machamp', 'victreebel', 'tentacruel', 'golem', 'rapidash', 'slowbro', 'magneton', 'farfetchd', 'dodrio', 'dewgong', 'muk', 'cloyster', 'gengar', 'onix', 'hypno', 'kingler', 'electrode', 'exeggutor', 'marowak', 'hitmonlee', 'hitmonchan', 'lickitung', 'weezing', 'rhydon', 'chansey', 'tangela', 'kangaskhan', 'seadra', 'seaking', 'starmie', 'mrmime', 'scyther', 'jynx', 'electabuzz', 'magmar', 'pinsir', 'tauros', 'gyarados', 'lapras', 'ditto', 'vaporeon', 'jolteon', 'flareon', 'porygon', 'omastar', 'kabutops', 'aerodactyl', 'snorlax', 'articuno', 'zapdos', 'moltres', 'dragonite', 'mewtwo', 'mew'];
		var johtoPool = ['meganium', 'typhlosion', 'feraligatr', 'furret', 'noctowl', 'ledian', 'ariados', 'crobat', 'lanturn', 'togetic', 'xatu', 'ampharos', 'bellossom', 'azumarill', 'sudowoodo', 'politoed', 'jumpluff', 'aipom', 'sunflora', 'yanma', 'quagsire', 'espeon', 'umbreon', 'murkrow', 'slowking', 'misdreavus', 'unown', 'wobbuffet', 'girafarig', 'forretress', 'dunsparce', 'gligar', 'steelix', 'granbull', 'qwilfish', 'scizor', 'shuckle', 'heracross', 'sneasel', 'ursaring', 'magcargo', 'piloswine', 'corsola', 'octillery', 'delibird', 'mantine', 'skarmory', 'houndoom', 'kingdra', 'donphan', 'porygon2', 'stantler', 'smeargle', 'hitmontop', 'miltank', 'blissey', 'raikou', 'entei', 'suicune', 'tyranitar', 'lugia', 'hooh', 'celebi'];
		var hoennPool = ['sceptile', 'blaziken', 'swampert', 'mightyena', 'linoone', 'beautifly', 'dustox', 'ludicolo', 'shiftry', 'swellow', 'pelipper', 'gardevoir', 'masquerain', 'breloom', 'slaking', 'ninjask', 'shedinja', 'exploud', 'hariyama', 'nosepass', 'delcatty', 'sableye', 'mawile', 'aggron', 'medicham', 'manectric', 'plusle', 'minun', 'volbeat', 'illumise', 'roselia', 'swalot', 'sharpedo', 'wailord', 'camerupt', 'torkoal', 'grumpig', 'spinda', 'flygon', 'cacturne', 'altaria', 'zangoose', 'seviper', 'lunatone', 'solrock', 'whiscash', 'crawdaunt', 'claydol', 'cradily', 'armaldo', 'milotic', 'castformsunny', 'castformrainy', 'kecleon', 'banette', 'dusclops', 'tropius', 'chimecho', 'absol', 'glalie', 'walrein', 'huntail', 'gorebyss', 'relicanth', 'luvdisc', 'salamence', 'metagross', 'regirock', 'regice', 'registeel', 'latias', 'latios', 'kyogre', 'groudon', 'rayquaza', 'jirachi', 'deoxys', 'deoxysattack', 'deoxysdefense', 'deoxysspeed'];
		var sinnohPool = ['torterra', 'infernape', 'empoleon', 'staraptor', 'bibarel', 'kricketune', 'luxray', 'roserade', 'rampardos', 'bastiodon', 'wormadam', 'wormadamsandy', 'wormadamtrash', 'mothim', 'vespiquen', 'pachirisu', 'floatzel', 'cherrim', 'gastrodon', 'ambipom', 'drifblim', 'lopunny', 'mismagius', 'honchkrow', 'purugly', 'skuntank', 'bronzong', 'chatot', 'spiritomb', 'garchomp', 'lucario', 'hippowdon', 'drapion', 'toxicroak', 'carnivine', 'lumineon', 'abomasnow', 'weavile', 'magnezone', 'lickilicky', 'rhyperior', 'tangrowth', 'electivire', 'magmortar', 'togekiss', 'yanmega', 'leafeon', 'glaceon', 'gliscor', 'mamoswine', 'porygonz', 'gallade', 'probopass', 'dusknoir', 'froslass', 'rotom', 'rotomheat', 'rotomwash', 'rotomfrost', 'rotomfan', 'rotommow', 'uxie', 'mesprit', 'azelf', 'dialga', 'palkia', 'heatran', 'regigigas', 'giratina', 'giratinaorigin', 'cresselia', 'phione', 'manaphy', 'darkrai', 'shaymin', 'shayminsky', 'arceus', 'arceusbug', 'arceusdark', 'arceusdragon', 'arceuselectric', 'arceusfairy', 'arceusfighting', 'arceusfire', 'arceusflying', 'arceusghost', 'arceusgrass', 'arceusground', 'arceusice', 'arceuspoison', 'arceuspsychic', 'arceusrock', 'arceussteel', 'arceuswater'];
		var unovaPool = ['victini', 'serperior', 'emboar', 'samurott', 'watchog', 'stoutland', 'liepard', 'simisage', 'simisear', 'simipour', 'musharna', 'unfezant', 'zebstrika', 'gigalith', 'swoobat', 'excadrill', 'audino', 'conkeldurr', 'seismitoad', 'throh', 'sawk', 'leavanny', 'scolipede', 'whimsicott', 'lilligant', 'basculin', 'basculinbluestriped', 'krookodile', 'darmanitan', 'maractus', 'crustle', 'scrafty', 'sigilyph', 'cofagrigus', 'carracosta', 'archeops', 'garbodor', 'zoroark', 'cinccino', 'gothitelle', 'reuniclus', 'swanna', 'vanilluxe', 'sawsbuck', 'emolga', 'escavalier', 'amoonguss', 'jellicent', 'alomomola', 'galvantula', 'ferrothorn', 'klinklang', 'eelektross', 'beheeyem', 'chandelure', 'haxorus', 'beartic', 'cryogonal', 'accelgor', 'stunfisk', 'mienshao', 'druddigon', 'golurk', 'bisharp', 'bouffalant', 'braviary', 'mandibuzz', 'heatmor', 'durant', 'hydreigon', 'volcarona', 'cobalion', 'terrakion', 'virizion', 'tornadus', 'tornadustherian', 'thundurus', 'thundurustherian', 'reshiram', 'zekrom', 'landorus', 'landorustherian', 'kyurem', 'kyuremwhite', 'kyuremblack', 'keldeo', 'meloetta', 'genesect'];
		var kalosPool = ['chesnaught', 'delphox', 'greninja', 'diggersby', 'talonflame', 'vivillon', 'pyroar', 'florges', 'gogoat', 'pangoro', 'furfrou', 'meowstic', 'meowsticf', 'aegislash', 'aromatisse', 'slurpuff', 'malamar', 'barbaracle', 'dragalge', 'clawitzer', 'heliolisk', 'tyrantrum', 'aurorus', 'sylveon', 'hawlucha', 'dedenne', 'carbink', 'goodra', 'klefki', 'trevenant', 'gourgeist', 'gourgeistsmall', 'gourgeistlarge', 'gourgeistsuper', 'avalugg', 'noivern', 'xerneas', 'yveltal', 'zygarde', 'diancie'];

		var dice = this.random(6);
		var teamGenerate = [];
		if (dice < 1) {
			teamGenerate = 'kantoTeam';
		} else if (dice < 2) {
			teamGenerate = 'johtoTeam';
		} else if (dice < 3) {
			teamGenerate = 'hoennTeam';
		} else if (dice < 4) {
			teamGenerate = 'sinnohTeam';
		} else if (dice < 5) {
			teamGenerate = 'unovaTeam';
		} else {
			teamGenerate = 'kalosTeam';
		}

		var pokemonPool = [];
		if (teamGenerate === 'kantoTeam') {
			pokemonPool = kantoPool;
		} else if (teamGenerate === 'johtoTeam') {
			pokemonPool = johtoPool;
		} else if (teamGenerate === 'hoennTeam') {
			pokemonPool = hoennPool;
		} else if (teamGenerate === 'sinnohTeam') {
			pokemonPool = sinnohPool;
		} else if (teamGenerate === 'unovaTeam') {
			pokemonPool = unovaPool;
		} else {
			pokemonPool = kalosPool;
		}

		var typeCount = {};
		var typeComboCount = {};
		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var megaCount = 0;

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			var tier = template.tier;
			switch (tier) {
			case 'LC':
			case 'LC Uber':
			case 'NFE':
				if (puCount > 1) continue;
				break;
			case 'PU':
				// PUs are limited to 2 but have a 20% chance of being added anyway.
				if (puCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'Uber':
				// Ubers are limited to 2 but have a 20% chance of being added anyway.
				if (uberCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(18) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Pumpkaboo':
				if (this.random(4) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Castform':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Cosplay Pikachu formes have 20% the normal rate (1/30 the normal rate each)
				if (template.species !== 'Pikachu' && this.random(30) >= 1) continue;
			}

			// Limit 2 of any type
			var types = template.types;
			var skip = false;
			for (var t = 0; t < types.length; t++) {
				if (typeCount[types[t]] > 1 && this.random(5) >= 1) {
					skip = true;
					break;
				}
			}
			if (skip) continue;

			var set = this.randomSet(template, pokemon.length, megaCount);

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit 1 of any type combination
			var typeCombo = types.join();
			if (set.ability === 'Drought' || set.ability === 'Drizzle') {
				// Drought and Drizzle don't count towards the type combo limit
				typeCombo = set.ability;
			}
			if (typeCombo in typeComboCount) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment type counters
			for (var t = 0; t < types.length; t++) {
				if (types[t] in typeCount) {
					typeCount[types[t]]++;
				} else {
					typeCount[types[t]] = 1;
				}
			}
			typeComboCount[typeCombo] = 1;

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU' || tier === 'LC' || tier === 'LC Uber' || tier === 'NFE') {
				puCount++;
			}

			// Increment mega and base species counters
			if (isMegaSet) megaCount++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	},
	randomCommunityTeam: function (side) {
		var pokemonLeft = 0;
		var pokemon = [];

		var pokemonPool = ['absol', 'aerodactyl', 'arcanine', 'archeops', 'aromatisse', 'azelf', 'bellossom', 'bidoof', 'blissey', 'castform', 'celebi', 'charizard', 'chesnaught', 'cofagrigus', 'cradily', 'cresselia', 'crobat', 'cyndaquil', 'darkrai', 'dragonite', 'emboar', 'espurr', 'feraligatr', 'gallade', 'galvantula', 'garchomp', 'gardevoir', 'gengar', 'golurk', 'gourgeist', 'greninja', 'heracross', 'hydreigon', 'igglybuff', 'infernape', 'jellicent', 'jigglypuff', 'jynx', 'lapras', 'latias', 'latios', 'liepard', 'ludicolo', 'magikarp', 'magneton', 'manectric', 'mantine', 'masquerain', 'mawile', 'meganium', 'metagross', 'metagrossmega', 'mew', 'mewtwo', 'milotic', 'mismagius', 'mudkip', 'nidoking', 'oddish', 'oshawott', 'pachirisu', 'pichu', 'pidgey', 'pikachu', 'porygon2', 'pumpkaboo', 'pupitar', 'raichu', 'reshiram', 'reuniclus', 'rhyperior', 'rotomfan', 'sableye', 'sandshrew', 'sandslash', 'sceptile', 'scolipede', 'scrafty', 'serperior', 'shaymin', 'skarmory', 'slowbro', 'snivy', 'spheal', 'staraptor', 'starmie', 'suicune', 'sylveon', 'tangela', 'togekiss', 'typhlosion', 'tyranitar', 'vaporeon', 'venusaur', 'victini', 'volcarona', 'vulpix', 'whimsicott', 'wigglytuff', 'zebstrika', 'zekrom'];

		var typeCount = {};
		var typeComboCount = {};
		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var megaCount = 0;

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			var tier = template.tier;
			switch (tier) {
			case 'LC':
			case 'LC Uber':
			case 'NFE':
				if (puCount > 1) continue;
				break;
			case 'PU':
				// PUs are limited to 2 but have a 20% chance of being added anyway.
				if (puCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'Uber':
				// Ubers are limited to 2 but have a 20% chance of being added anyway.
				if (uberCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(18) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Pumpkaboo':
				if (this.random(4) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Castform':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Cosplay Pikachu formes have 20% the normal rate (1/30 the normal rate each)
				if (template.species !== 'Pikachu' && this.random(30) >= 1) continue;
			}

			// Limit 2 of any type
			var types = template.types;
			var skip = false;
			for (var t = 0; t < types.length; t++) {
				if (typeCount[types[t]] > 1 && this.random(5) >= 1) {
					skip = true;
					break;
				}
			}
			if (skip) continue;

			var set = this.randomSet(template, pokemon.length, megaCount);

			if (template.id === 'absol') {
				set.species = 'Absol';
				set.name = 'Sanguine';
			} else if (template.id === 'aerodactyl') {
				set.species = 'Aerodactyl';
				set.name = 'H.A.N.';
			} else if (template.id === 'arcanine') {
				set.species = 'Arcanine';
				var dice = this.random(2);
				if (dice < 1) {
					set.name = 'Aslan';
				} else {
					set.name = 'El Héroe';
					set.item = 'Life Orb';
					set.ability = 'Flash Fire';
					set.moves = ['Flare Blitz', 'Extreme Speed', 'Close Combat', 'Crunch'];
					set.nature = 'Adamant';
					set.evs = {hp: 0, def: 4, spd: 0, spa: 0, atk: 252, spe: 252};
				}
			} else if (template.id === 'archeops') {
				set.species = 'Archeops';
				set.name = 'Nightanglet';
				set.moves = ['Acrobatics', 'Earthquake', 'Aqua Tail', 'Knock Off'];
				set.nature = 'Jolly';
				set.evs = {hp: 0, def: 0, spd: 0, spa: 0, atk: 252, spe: 252};
			} else if (template.id === 'aromatisse') {
				set.species = 'Aromatisse';
				set.name = 'Wilhelm';
			} else if (template.id === 'azelf') {
				set.species = 'Azelf';
				set.name = 'Dark Azelf';
			} else if (template.id === 'bellossom') {
				set.species = 'Bellossom';
				set.name = 'Leijon';
				set.gender = 'F';
				set.moves = ['Petal Dance', 'Attract', 'Hidden Power Fire', 'Synthesis'];
			} else if (template.id === 'bidoof') {
				set.species = 'Bidoof';
				set.name = 'Lalapizzame';
			} else if (template.id === 'blissey') {
				set.species = 'Blissey';
				set.name = 'Sonata';
				set.gender = 'F';
				set.item = 'Assault Vest';
				set.ability = 'Serene Grace';
				set.moves = ['Fire Blast', 'Thunder', 'Blizzard', 'Psychic'];
				set.nature = 'Modest';
				set.evs = {hp: 4, def: 252, spd: 0, spa: 252, atk: 0, spe: 0};
			} else if (template.id === 'castform') {
				set.species = 'Castform';
				set.name = 'Powalen';
			} else if (template.id === 'celebi') {
				set.species = 'Celebi';
				set.name = 'R.F.';
			} else if (template.id === 'charizard') {
				set.species = 'Charizard';
				var dice = this.random(2);
				if (dice < 1) {
					set.name = 'IndianCharizard#';
				} else {
					set.name = 'Rukario';
				}
			} else if (template.id === 'chesnaught') {
				set.species = 'Chesnaught';
				set.name = 'gio7sm';
				set.item = 'Leftovers';
				set.ability = 'Bulletproof';
				set.moves = ['Spiky Shield', 'Leech Seed', 'Hammer Arm', 'Spikes'];
				set.nature = 'Impish';
				set.evs = {hp: 252, def: 252, spd: 4, spa: 0, atk: 0, spe: 0};
			} else if (template.id === 'cofagrigus') {
				set.species = 'Cofagrigus';
				set.name = 'Zeffy';
			} else if (template.id === 'cradily') {
				set.species = 'Cradily';
				set.name = 'oocyst';
				set.item = 'Leftovers';
				set.moves = ['Curse', 'Recover', 'Rock Slide', 'Seed Bomb'];
				set.nature = 'Careful';
				set.evs = {hp: 252, def: 4, spd: 252, spa: 0, atk: 0, spe: 0};
			} else if (template.id === 'cresselia') {
				set.species = 'Cresselia';
				set.name = 'Sphealo';
				set.item = 'Light Clay';
				set.ability = 'Levitate';
				set.moves = ['Reflect', 'Light Screen', 'Lunar Dance', 'Moonblast'];
				set.nature = 'Timid';
				set.evs = {hp: 252, def: 4, spd: 0, spa: 0, atk: 0, spe: 252};
			} else if (template.id === 'crobat') {
				set.species = 'Crobat';
				set.name = 'Timbjerr';
			} else if (template.id === 'cyndaquil') {
				set.species = 'Cyndaquil';
				set.name = 'Gallant192';
			} else if (template.id === 'darkrai') {
				set.species = 'Darkrai';
				set.name = 'Dark Light1999';
				set.item = 'Wide Lens';
				set.ability = 'Bad Dreams';
				set.moves = ['Dark Void', 'Dark Pulse', 'Dream Eater', 'Ice Beam'];
				set.nature = 'Timid';
				set.evs = {hp: 0, def: 0, spd: 4, spa: 252, atk: 0, spe: 252};
			} else if (template.id === 'dragonite') {
				set.species = 'Dragonite';
				set.name = 'Dark Shadow 6';
			} else if (template.id === 'emboar') {
				set.item = 'Choice Scarf';
				set.ability = 'Reckless';
				set.moves = ['Head Smash', 'Flare Blitz', 'Wild Charge', 'Superpower'];
				set.nature = 'Jolly';
				set.evs = {hp: 4, def: 0, spd: 0, spa: 0, atk: 252, spe: 252};
			} else if (template.id === 'espurr') {
				set.species = 'Espurr';
				set.name = 'machomuu';
			} else if (template.id === 'feraligatr') {
				set.species = 'Feraligatr';
				set.name = 'Jin Of The Gale';
			} else if (template.id === 'gallade') {
				set.species = 'Gallade';
				set.name = 'PlatinumDude';
			} else if (template.id === 'galvantula') {
				set.species = 'Galvantula';
				set.name = 'Synerjee';
			} else if (template.id === 'garchomp') {
				set.species = 'Garchomp';
				var dice = this.random(2);
				if (dice < 1) {
					set.name = 'Exile';
				} else {
					set.name = 'ThePoople';
					set.item = 'Choice Band';
					set.ability = 'Rough Skin';
					set.moves = ['Earthquake', 'Outrage', 'Iron Head', 'Crunch'];
					set.nature = 'Jolly';
					set.evs = {hp: 0, def: 0, spd: 4, spa: 0, atk: 252, spe: 252};
				}
			} else if (template.id === 'gardevoir') {
				set.species = 'Gardevoir';
				set.name = 'Jellicent♀';
			} else if (template.id === 'gengar') {
				set.species = 'Gengar';
				set.name = 'Spartacus';
			} else if (template.id === 'golurk') {
				set.species = 'Golurk';
				set.name = 'Sheerow';
			} else if (template.id === 'gourgeist') {
				set.species = 'Gourgeist';
				set.name = 'Flushed';
			} else if (template.id === 'greninja') {
				set.species = 'Greninja';
				set.name = 'Chocolate™';
			} else if (template.id === 'heracross') {
				set.species = 'Heracross';
				set.name = 'Jake♫';
			} else if (template.id === 'hydreigon') {
				set.species = 'Hydreigon';
				set.name = 'Overlord Drakow';
			} else if (template.id === 'igglybuff') {
				set.species = 'Igglybuff';
				set.name = '«Chuckles»';
			} else if (template.id === 'infernape') {
				set.species = 'Infernape';
				set.name = 'Nathan';
			} else if (template.id === 'jellicent') {
				set.species = 'Jellicent';
				set.name = '2Fruit';
				set.item = 'Leftovers';
				set.ability = 'Water Absorb';
				set.moves = ['Recover', 'Scald', 'Will-O-Wisp', 'Night Shade'];
				set.nature = 'Bold';
				set.evs = {hp: 252, def: 124, spd: 132, spa: 0, atk: 0, spe: 0};
			} else if (template.id === 'jigglypuff') {
				set.species = 'Jigglypuff';
				set.name = 'JatinGupta';
				set.item = 'Eviolite';
				set.ability = 'Cute Charm';
				set.moves = ['Hyper Voice', 'Double-Edge', 'Rollout', 'Body Slam'];
				set.nature = 'Sassy';
				set.evs = {hp: 252, def: 0, spd: 0, spa: 252, atk: 4, spe: 0};
			} else if (template.id === 'jynx') {
				set.species = 'Jynx';
				set.name = 'mystletainn';
			} else if (template.id === 'lapras') {
				set.species = 'Lapras';
				set.name = 'Altairis';
			} else if (template.id === 'latias') {
				set.species = 'Latias';
				set.name = 'Sector';
			} else if (template.id === 'latios') {
				set.species = 'Latios';
				set.name = 'Retribution';
			} else if (template.id === 'liepard') {
				set.species = 'Liepard';
				set.name = 'Bruce Banner';
			} else if (template.id === 'ludicolo') {
				set.species = 'Ludicolo';
				set.name = 'Omicron';
			} else if (template.id === 'magikarp') {
				set.species = 'Magikarp';
				set.name = 'Clacla';
			} else if (template.id === 'magneton') {
				set.species = 'Magneton';
				set.name = 'Archer99';
				set.item = 'Choice Specs';
				set.ability = 'Magnet Pull';
				set.moves = ['Thunderbolt', 'Flash Cannon', 'Volt Switch', 'Hidden Power Fire'];
				set.nature = 'Modest';
				set.evs = {hp: 4, def: 0, spd: 0, spa: 252, atk: 0, spe: 252};
			} else if (template.id === 'manectric') {
				set.species = 'Manectric';
				set.name = 'antemortem';
				set.item = 'Manectite';
				set.moves = ['Volt Switch', 'Thunderbolt', 'Hidden Power Grass', 'Flamethrower'];
			} else if (template.id === 'mantine') {
				set.species = 'Mantine';
				set.name = 'Blu·Ray';
			} else if (template.id === 'masquerain') {
				set.species = 'Masquerain';
				set.name = 'stranger';
			} else if (template.id === 'mawile') {
				set.species = 'Mawile';
				set.name = 'revere';
			} else if (template.id === 'meganium') {
				set.species = 'Meganium';
				set.name = 'Axeliira';
			} else if (template.id === 'metagross') {
				set.species = 'Metagross';
				set.name = 'punkysaur';
				set.item = 'Metagrossite';
				set.moves = ['Meteor Mash', 'Zen Headbutt', 'Ice Punch', 'Earthquake'];
				set.nature = 'Jolly';
				set.evs = {hp: 0, def: 0, spd: 4, spa: 0, atk: 252, spe: 252};
			} else if (template.id === 'metagrossmega') {
				set.species = 'Metagross-Mega';
				set.name = 'Syndrome';
				set.item = 'Metagrossite';
				set.moves = ['Meteor Mash', 'Zen Headbutt', 'Hammer Arm', 'Pursuit'];
				set.nature = 'Jolly';
				set.evs = {hp: 0, def: 0, spd: 4, spa: 0, atk: 252, spe: 252};
			} else if (template.id === 'mew') {
				set.species = 'Mew';
				set.name = 'Rϵd';
			} else if (template.id === 'mewtwo') {
				set.species = 'Mewtwo';
				set.name = 'Dakota';
			} else if (template.id === 'milotic') {
				set.species = 'Milotic';
				var dice = this.random(2);
				if (dice < 1) {
					set.name = 'Dragon';
				} else {
					set.name = 'TGM';
				}
			} else if (template.id === 'mismagius') {
				set.species = 'Mismagius';
				set.name = 'Polar Spectrum';
				set.item = 'Colbur Berry';
				set.moves = ['Will-O-Wisp', 'Hex', 'Nasty Plot', 'Power Gem'];
				set.nature = 'Timid';
				set.evs = {hp: 0, def: 0, spd: 4, spa: 252, atk: 0, spe: 252};
			} else if (template.id === 'mudkip') {
				set.species = 'Mudkip';
				set.name = 'Bidoof FTW';
			} else if (template.id === 'nidoking') {
				set.species = 'Nidoking';
				set.name = 'jdthebud';
			} else if (template.id === 'oddish') {
				set.species = 'Oddish';
				set.name = 'oddísh';
				set.item = 'Eviolite';
				set.ability = 'Chlorophyll';
				set.moves = ['Solar Beam', 'Sludge Bomb', 'Sunny Day', 'Sleep Powder'];
				set.nature = 'Timid';
				set.evs = {hp: 4, def: 0, spd: 0, spa: 252, atk: 0, spe: 252};
			} else if (template.id === 'oshawott') {
				set.species = 'Oshawott';
				set.name = 'Hikamaru';
			} else if (template.id === 'pachirisu') {
				set.species = 'Pachirisu';
				set.name = 'Melody';
				set.gender = 'F';
				set.shiny = true;
				set.moves[0] = 'Attract';
				set.moves[1] = 'Nuzzle';
			} else if (template.id === 'pichu') {
				set.species = 'pichu';
				set.name = 'Lost Christmas';
				set.item = 'Life Orb';
				set.moves = ['Volt Tackle', 'Grass Knot', 'Toxic', 'Return'];
			} else if (template.id === 'pidgey') {
				set.species = 'Pidgey';
				set.name = 'Olli';
			} else if (template.id === 'pikachu') {
				set.species = 'Pikachu';
				set.name = 'Kaori';
			} else if (template.id === 'porygon2') {
				set.species = 'Porygon2';
				set.name = 'Euphoric';
			} else if (template.id === 'pumpkaboo') {
				set.species = 'Pumpkaboo';
				set.name = 'Forever';
			} else if (template.id === 'pupitar') {
				set.species = 'Pupitar';
				set.name = 'KFCutman';
				set.item = 'Eviolite';
				set.moves = ['Outrage', 'Rock Polish', 'Dragon Dance', 'Earthquake'];
			} else if (template.id === 'raichu') {
				set.species = 'Raichu';
				set.name = 'Livewire';
			} else if (template.id === 'reshiram') {
				set.species = 'Reshiram';
				set.name = 'Yet Another Logical Nerd';
			} else if (template.id === 'reuniclus') {
				set.species = 'Reuniclus';
				set.name = 'Dark Pit';
			} else if (template.id === 'rhyperior') {
				set.species = 'Rhyperior';
				set.name = 'Terra';
				set.gender = 'M';
				set.item = 'Focus Sash';
				set.ability = 'Lightning Rod';
				set.moves = ['Stone Edge', 'Stealth Rock', 'Megahorn', 'Avalanche'];
				set.nature = 'Jolly';
				set.evs = {hp: 0, def: 0, spd: 4, spa: 0, atk: 252, spe: 252};
			} else if (template.id === 'rotomfan') {
				set.species = 'Rotom-Fan';
				set.name = 'littlebrother';
				set.item = 'Leftovers';
				set.moves = ['Discharge', 'Pain Split', 'Air Slash', 'Substitute'];
			} else if (template.id === 'sableye') {
				set.species = 'Sableye';
				set.name = 'srinator';
				set.item = 'Sablenite';
				set.moves = ['Will-O-Wisp', 'Dark Pulse', 'Recover', 'Calm Mind'];
			} else if (template.id === 'sandshrew') {
				set.species = 'Sandshrew';
				set.name = 'Squirrel';
			} else if (template.id === 'sandslash') {
				set.species = 'Sandslash';
				set.name = 'destinedjagold';
				set.item = 'Choice Scarf';
				set.ability = 'Sand Rush';
				set.moves = ['Earthquake', 'Rock Tomb', 'Poison Jab', 'Chip Away'];
				set.evs = {hp: 0, def: 0, spd: 252, spa: 0, atk: 252, spe: 4};
			} else if (template.id === 'sceptile') {
				set.species = 'Sceptile';
				set.name = 'Regeneration';
			} else if (template.id === 'scolipede') {
				set.species = 'Scolipede';
				set.name = 'Pendraflare';
			} else if (template.id === 'scrafty') {
				set.species = 'Scrafty';
				set.name = 'Atwilko';
			} else if (template.id === 'serperior') {
				set.species = 'Serperior';
				set.name = 'Nolafus';
			} else if (template.id === 'shaymin') {
				set.species = 'Shaymin';
				set.name = 'Zorua';
			} else if (template.id === 'skarmory') {
				set.species = 'Skarmory';
				set.name = 'nizo';
			} else if (template.id === 'slowbro') {
				set.species = 'Slowbro';
				set.name = '.Aero';
			} else if (template.id === 'snivy') {
				set.species = 'Snivy';
				set.name = 'Tsutarja';
			} else if (template.id === 'spheal') {
				set.species = 'Spheal';
				set.name = 'Christos';
				set.moves = ['Freeze-Dry', 'Surf', 'Yawn', 'Super Fang'];
			} else if (template.id === 'staraptor') {
				set.species = 'Staraptor';
				var dice = this.random(2);
				if (dice < 1) {
					set.name = 'BadPokemon';
					set.item = 'Choice Band';
					set.ability = 'Reckless';
					set.moves = ['Double-Edge', 'Quick Attack', 'Brave Bird', 'Close Combat'];
					set.nature = 'Adamant';
				} else {
					set.name = 'Rabinov';
					set.item = 'Leftovers';
					set.ability = 'Intimidate';
					set.moves = ['Brave Bird', 'Feather Dance', 'Roost', 'Defog'];
					set.nature = 'Impish';
					set.evs = {hp: 252, def: 176, spd: 0, spa: 0, atk: 0, spe: 80};
				}
			} else if (template.id === 'starmie') {
				set.species = 'Starmie';
				set.name = 'shenanigans';
			} else if (template.id === 'suicune') {
				set.species = 'Suicune';
				set.name = 'wolf';
				set.item = 'Leftovers';
				set.moves = ['Scald', 'Calm Mind', 'Rest', 'Sleep Talk'];
				set.nature = 'Bold';
				set.evs = {hp: 252, def: 252, spd: 4, spa: 0, atk: 0, spe: 0};
			} else if (template.id === 'sylveon') {
				set.species = 'Sylveon';
				var dice = this.random(2);
				if (dice < 1) {
					set.name = 'Harmonious Fusion';
				} else {
					set.name = 'pixie^.^forest';
				}
			} else if (template.id === 'tangela') {
				set.species = 'Tangela';
				set.name = 'Yoshikko';
				set.item = 'Eviolite';
				set.ability = 'Regenerator';
				set.moves = ['Giga Drain', 'Sleep Powder', 'Leech Seed', 'Hidden Power Fire'];
				set.nature = 'Bold';
				set.evs = {hp: 252, def: 252, spd: 0, spa: 0, atk: 0, spe: 4};
			} else if (template.id === 'togekiss') {
				set.species = 'Togekiss';
				set.name = 'Aurora';
			} else if (template.id === 'typhlosion') {
				set.species = 'Typhlosion';
				set.name = 'ShadowE';
			} else if (template.id === 'tyranitar') {
				set.species = 'Tyranitar';
				set.name = 'dontstay96';
			} else if (template.id === 'vaporeon') {
				set.species = 'Vaporeon';
				var dice = this.random(2);
				if (dice < 1) {
					set.name = 'Eevee-kins';
				} else {
					set.name = 'Furoichi';
					set.item = 'Leftovers';
					set.ability = 'Water Absorb';
					set.moves = ['Wish', 'Protect', 'Scald', 'Baton Pass'];
					set.nature = 'Calm';
					set.evs = {hp: 200, def: 252, spd: 56, spa: 0, atk: 0, spe: 0};
				}
			} else if (template.id === 'venusaur') {
				set.species = 'Venusaur';
				set.name = 'Garrabutártulo';
			} else if (template.id === 'victini') {
				set.species = 'Victini';
				set.name = 'Starry Windy';
			} else if (template.id === 'volcarona') {
				set.species = 'Volcarona';
				set.name = 'Lilith';
			} else if (template.id === 'vulpix') {
				set.species = 'Vulpix';
				set.name = 'Peitharchia';
			} else if (template.id === 'whimsicott') {
				set.species = 'Whimsicott';
				set.name = 'Sheep';
			} else if (template.id === 'wigglytuff') {
				set.species = 'Wigglytuff';
				set.name = 'White Mage';
			} else if (template.id === 'zebstrika') {
				set.species = 'Zebstrika';
				set.name = 'Vrai';
			}

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit 1 of any type combination
			var typeCombo = types.join();
			if (set.ability === 'Drought' || set.ability === 'Drizzle') {
				// Drought and Drizzle don't count towards the type combo limit
				typeCombo = set.ability;
			}
			if (typeCombo in typeComboCount) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment type counters
			for (var t = 0; t < types.length; t++) {
				if (types[t] in typeCount) {
					typeCount[types[t]]++;
				} else {
					typeCount[types[t]] = 1;
				}
			}
			typeComboCount[typeCombo] = 1;

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU' || tier === 'LC' || tier === 'LC Uber' || tier === 'NFE') {
				puCount++;
			}

			// Increment mega and base species counters
			if (isMegaSet) megaCount++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	},
	randomSummerSendoffSets: require('./summer-send-off-sets.json'),
	randomSummerSendoffSet: function (template, slot, teamOwner) {
		var speciesId = toId(template.species);
		var setList = this.randomSummerSendoffSets[teamOwner][speciesId].sets;
		var effectivePool = [];

		for (var i = 0, l = setList.length; i < l; i++) {
			var curSet = setList[i];
			var curSetVariants = [];
			for (var j = 0, m = curSet.moves.length; j < m; j++) {
				var variantIndex = this.random(curSet.moves[j].length);
				curSetVariants.push(variantIndex);
			}
			effectivePool.push({set: curSet, moveVariants: curSetVariants});
		}

		var setData = effectivePool[this.random(effectivePool.length)];
		var moves = [];
		for (var i = 0; i < setData.set.moves.length; i++) {
			var moveSlot = setData.set.moves[i];
			moves.push(setData.moveVariants ? moveSlot[setData.moveVariants[i]] : moveSlot[this.random(moveSlot.length)]);
		}

		return {
			name: setData.set.name || setData.set.species,
			species: setData.set.species,
			gender: setData.set.gender || template.gender || (this.random() ? 'M' : 'F'),
			item: setData.set.item || '',
			ability: setData.set.ability || template.abilities['0'],
			shiny: typeof setData.set.shiny === 'undefined' ? !this.random(1024) : setData.set.shiny,
			level: 100,
			happiness: typeof setData.set.happiness === 'undefined' ? 255 : setData.set.happiness,
			evs: setData.set.evs || {hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84},
			ivs: setData.set.ivs || {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31},
			nature: setData.set.nature || 'Serious',
			moves: moves
		};
	},
	randomSummerSendoffTeam: function () {
		var availableTeams = ['Chase', 'AmourPearlShipper', 'Nah', 'static', 'gio7sm', 'LegendaryGaming', 'Archy', 'punkysaur'];
		var chosenTeam;
		chosenTeam = availableTeams[this.random(availableTeams.length)];

		var pokemonLeft = 0;
		var pokemon = [];

		var pokemonPool = Object.keys(this.randomSummerSendoffSets[chosenTeam]);

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			var set = this.randomSummerSendoffSet(template, pokemon.length, chosenTeam);
			if (!set) continue;

			pokemon.push(set);
			pokemonLeft++;
		}
		return pokemon;
	},
	randomSpringTeam: function (side) {
		var pokemonLeft = 0;
		var pokemon = [this.randomSet(this.getTemplate('castform'), 0)];

		var pokemonPool = ['amoonguss', 'arceusgrass', 'bayleef', 'bellossom', 'bellsprout', 'breloom', 'budew', 'bulbasaur', 'cacnea', 'cacturne', 'carnivine', 'celebi', 'cherrim', 'cherubi', 'chesnaught', 'chespin', 'chikorita', 'cottonee', 'cradily', 'deerling', 'exeggcute', 'exeggutor', 'ferroseed', 'ferrothorn', 'foongus', 'gloom', 'gogoat', 'gourgeist', 'gourgeistlarge', 'gourgeistsmall', 'gourgeistsuper', 'grotle', 'grovyle', 'hoppip', 'ivysaur', 'jumpluff', 'leafeon', 'leavanny', 'lileep', 'lilligant', 'lombre', 'lotad', 'ludicolo', 'maractus', 'meganium', 'nuzleaf', 'oddish', 'pansage', 'paras', 'parasect', 'petilil', 'phantump', 'pumpkaboo', 'pumpkaboolarge', 'pumpkaboosmall', 'pumpkaboosuper', 'quilladin', 'roselia', 'roserade', 'rotommow', 'sawsbuck', 'sceptile', 'seedot', 'serperior', 'servine', 'sewaddle', 'shaymin', 'shayminsky', 'shiftry', 'shroomish', 'simisage', 'skiddo', 'skiploom', 'snivy', 'sunflora', 'sunkern', 'swadloon', 'tangela', 'tangrowth', 'torterra', 'treecko', 'trevenant', 'tropius', 'turtwig', 'venusaur', 'victreebel', 'vileplume', 'virizion', 'weepinbell', 'whimsicott', 'wormadam', 'accelgor', 'anorith', 'arceusbug', 'ariados', 'armaldo', 'beautifly', 'beedrill', 'burmy', 'butterfree', 'cascoon', 'caterpie', 'combee', 'crustle', 'durant', 'dustox', 'dwebble', 'escavalier', 'forretress', 'galvantula', 'genesect', 'heracross', 'illumise', 'joltik', 'kakuna', 'karrablast', 'kricketot', 'kricketune', 'larvesta', 'ledian', 'ledyba', 'masquerain', 'metapod', 'mothim', 'nincada', 'ninjask', 'pineco', 'pinsir', 'scatterbug', 'scizor', 'scolipede', 'scyther', 'shedinja', 'shelmet', 'shuckle', 'silcoon', 'skorupi', 'spewpa', 'spinarak', 'surskit', 'venipede', 'venomoth', 'venonat', 'vespiquen', 'vivillon', 'volbeat', 'volcarona', 'weedle', 'whirlipede', 'wurmple', 'yanma', 'yanmega', 'altaria', 'arceusfairy', 'aromatisse', 'audino', 'azumarill', 'azurill', 'carbink', 'clefable', 'clefairy', 'cleffa', 'dedenne', 'diancie', 'flabebe', 'floette', 'florges', 'gardevoir', 'granbull', 'igglybuff', 'jigglypuff', 'kirlia', 'klefki', 'marill', 'mawile', 'mimejr', 'mrmime', 'ralts', 'slurpuff', 'snubbull', 'spritzee', 'swirlix', 'sylveon', 'togekiss', 'togepi', 'togetic', 'wigglytuff', 'xerneas', 'arceusflying', 'braviary', 'chatot', 'crobat', 'dodrio', 'doduo', 'drifblim', 'drifloon', 'ducklett', 'emolga', 'farfetchd', 'fearow', 'fletchinder', 'fletchling', 'gligar', 'gliscor', 'golbat', 'hawlucha', 'hooh', 'honchkrow', 'hoothoot', 'landorus', 'landorustherian', 'lugia', 'mandibuzz', 'moltres', 'murkrow', 'natu', 'noctowl', 'noibat', 'noivern', 'pelipper', 'pidgeot', 'pidgeotto', 'pidgey', 'pidove', 'rayquaza', 'rufflet', 'skarmory', 'spearow', 'staraptor', 'staravia', 'starly', 'swablu', 'swanna', 'swellow', 'swoobat', 'taillow', 'talonflame', 'thundurus', 'thundurustherian', 'tornadus', 'tornadustherian', 'tranquill', 'unfezant', 'vullaby', 'wingull', 'woobat', 'xatu', 'zapdos', 'zubat', 'nidoranf', 'nidorina', 'nidoranm', 'nidorino', 'sentret', 'whismur', 'plusle', 'minun', 'spinda', 'buneary', 'lopunny', 'victini', 'bunnelby', 'diggersby', 'rattata', 'raticate', 'pikachu', 'pikachucosplay', 'pikachurockstar', 'pikachubelle', 'pikachupopstar', 'pikachuphd', 'pikachulibre', 'pikachucosplay', 'pikachurockstar', 'pikachubelle', 'pikachupopstar', 'pikachuphd', 'pikachulibre', 'raichu', 'sandshrew', 'sandslash', 'diglett', 'dugtrio', 'cyndaquil', 'quilava', 'furret', 'pichu', 'zigzagoon', 'linoone', 'bidoof', 'bibarel', 'pachirisu', 'patrat', 'watchog', 'drilbur', 'excadrill', 'minccino', 'cinccino', 'kyogre', 'groudon'];

		var typeCount = {};
		var typeComboCount = {};
		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var megaCount = 0;

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			var tier = template.tier;
			switch (tier) {
			case 'LC':
			case 'LC Uber':
			case 'NFE':
				if (puCount > 1) continue;
				break;
			case 'PU':
				// PUs are limited to 2 but have a 20% chance of being added anyway.
				if (puCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'Uber':
				// Ubers are limited to 2 but have a 20% chance of being added anyway.
				if (uberCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(3) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Pumpkaboo':
				if (this.random(4) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Castform':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Cosplay Pikachu formes have 20% the normal rate (1/30 the normal rate each)
				if (template.species !== 'Pikachu' && this.random(30) >= 1) continue;
			}

			// Limit 2 of any type
			var types = template.types;
			var skip = false;
			for (var t = 0; t < types.length; t++) {
				if (typeCount[types[t]] > 1 && this.random(5) >= 1) {
					skip = true;
					break;
				}
			}
			if (skip) continue;

			var set = this.randomSet(template, pokemon.length, megaCount);

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit 1 of any type combination
			var typeCombo = types.join();
			if (set.ability === 'Drought' || set.ability === 'Drizzle') {
				// Drought and Drizzle don't count towards the type combo limit
				typeCombo = set.ability;
			}
			if (typeCombo in typeComboCount) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment type counters
			for (var t = 0; t < types.length; t++) {
				if (types[t] in typeCount) {
					typeCount[types[t]]++;
				} else {
					typeCount[types[t]] = 1;
				}
			}
			typeComboCount[typeCombo] = 1;

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU' || tier === 'LC' || tier === 'LC Uber' || tier === 'NFE') {
				puCount++;
			}

			// Increment mega and base species counters
			if (isMegaSet) megaCount++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	},
	randomOrbTeam: function (side) {
		var pokemonLeft = 0;
		var pokemon = [];

		var pokemonPool = ['shellder', 'cloyster', 'gastly', 'voltorb', 'electrode', 'koffing', 'ditto', 'sunkern', 'unown', 'pineco', 'forretress', 'silcoon', 'cascoon', 'lunatone', 'solrock', 'castformsunny', 'castformrainy', 'shuppet', 'glalie', 'clamperl', 'bronzor', 'rotom', 'whirlipede', 'cottonee', 'solosis', 'duosion', 'ferroseed', 'cryogonal', 'shelmet', 'carbink', 'klefki', 'pumpkaboo', 'pumpkaboolarge', 'pumpkaboosmall', 'pumpkaboosuper', 'hoopa', 'goomy', 'chinchou', 'qwilfish', 'wailmer', 'spheal', 'tympole', 'geodude', 'magnemite', 'gulpin', 'spoink', 'chimecho', 'metang', 'drifloon', 'drifblim', 'magnezone', 'phione', 'swadloon', 'yamask', 'foongus', 'amoonguss', 'lampent', 'chandelure', 'spritzee', 'phantump', 'burmy', 'spiritomb', 'petilil', 'vanillite', 'litwick', 'spewpa', 'clefairy', 'mankey', 'primeape', 'gengar', 'chansey', 'cleffa', 'marill', 'azumarill', 'hoppip', 'skiploom', 'jumpluff', 'whismur', 'gible', 'palpitoad', 'quilladin', 'dedenne', 'oddish', 'poliwag', 'doduo', 'dodrio', 'exeggutor', 'tangela', 'seedot', 'shroomish', 'azurill', 'cherrim', 'roggenrola', 'swirlix', 'swinub', 'phanpy', 'donphan', 'shelgon', 'shaymin', 'munna', 'hoothoot', 'natu', 'woobat', 'tentacool', 'omanyte', 'omastar', 'jellicent', 'ferrothorn', 'magneton', 'exeggcute', 'weezing', 'cherubi', 'klink', 'klang', 'klinklang', 'jigglypuff', 'gloom', 'vileplume', 'venonat', 'poliwhirl', 'poliwrath', 'graveler', 'golem', 'igglybuff', 'togepi', 'blissey', 'cacnea', 'budew', 'chingling', 'happiny', 'tangrowth', 'musharna', 'darumaka', 'trubbish', 'kabuto', 'shuckle', 'dwebble', 'lanturn'];

		var typeCount = {};
		var typeComboCount = {};
		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var megaCount = 0;

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			var tier = template.tier;
			switch (tier) {
			case 'LC':
			case 'LC Uber':
			case 'NFE':
				if (puCount > 1) continue;
				break;
			case 'PU':
				// PUs are limited to 2 but have a 20% chance of being added anyway.
				if (puCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'Uber':
				// Ubers are limited to 2 but have a 20% chance of being added anyway.
				if (uberCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(18) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Pumpkaboo':
				if (this.random(4) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Castform':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Cosplay Pikachu formes have 20% the normal rate (1/30 the normal rate each)
				if (template.species !== 'Pikachu' && this.random(30) >= 1) continue;
			}

			// Limit 2 of any type
			var types = template.types;
			var skip = false;
			for (var t = 0; t < types.length; t++) {
				if (typeCount[types[t]] > 1 && this.random(5) >= 1) {
					skip = true;
					break;
				}
			}
			if (skip) continue;

			var set = this.randomSet(template, pokemon.length, megaCount);

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit 1 of any type combination
			var typeCombo = types.join();
			if (set.ability === 'Drought' || set.ability === 'Drizzle') {
				// Drought and Drizzle don't count towards the type combo limit
				typeCombo = set.ability;
			}
			if (typeCombo in typeComboCount) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment type counters
			for (var t = 0; t < types.length; t++) {
				if (types[t] in typeCount) {
					typeCount[types[t]]++;
				} else {
					typeCount[types[t]] = 1;
				}
			}
			typeComboCount[typeCombo] = 1;

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU' || tier === 'LC' || tier === 'LC Uber' || tier === 'NFE') {
				puCount++;
			}

			// Increment mega and base species counters
			if (isMegaSet) megaCount++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	},
	randomHoennTeam: function (side) {
		var pokemonLeft = 0;
		var pokemon = [];

		var pokemonPool = ['treecko', 'grovyle', 'sceptile', 'torchic', 'combusken', 'blaziken', 'mudkip', 'marshtomp', 'swampert', 'poochyena', 'mightyena', 'zigzagoon', 'linoone', 'wurmple', 'silcoon', 'beautifly', 'cascoon', 'dustox', 'lotad', 'lombre', 'ludicolo', 'seedot', 'nuzleaf', 'shiftry', 'taillow', 'swellow', 'wingull', 'pelipper', 'ralts', 'kirlia', 'gardevoir', 'surskit', 'masquerain', 'shroomish', 'breloom', 'slakoth', 'vigoroth', 'slaking', 'abra', 'kadabra', 'alakazam', 'nincada', 'ninjask', 'shedinja', 'whismur', 'loudred', 'exploud', 'makuhita', 'hariyama', 'goldeen', 'seaking', 'magikarp', 'gyarados', 'azurill', 'marill', 'azumarill', 'geodude', 'graveler', 'golem', 'nosepass', 'skitty', 'delcatty', 'zubat', 'golbat', 'crobat', 'tentacool', 'tentacruel', 'sableye', 'mawile', 'aron', 'lairon', 'aggron', 'machop', 'machoke', 'machamp', 'meditite', 'medicham', 'electrike', 'manectric', 'plusle', 'minun', 'magnemite', 'magneton', 'voltorb', 'electrode', 'volbeat', 'illumise', 'oddish', 'gloom', 'vileplume', 'bellossom', 'doduo', 'dodrio', 'roselia', 'gulpin', 'swalot', 'carvanha', 'sharpedo', 'wailmer', 'wailord', 'numel', 'camerupt', 'slugma', 'magcargo', 'torkoal', 'grimer', 'muk', 'koffing', 'weezing', 'spoink', 'grumpig', 'sandshrew', 'sandslash', 'spinda', 'skarmory', 'trapinch', 'vibrava', 'flygon', 'cacnea', 'cacturne', 'swablu', 'altaria', 'zangoose', 'seviper', 'lunatone', 'solrock', 'barboach', 'whiscash', 'corphish', 'crawdaunt', 'baltoy', 'claydol', 'lileep', 'cradily', 'anorith', 'armaldo', 'igglybuff', 'jigglypuff', 'wigglytuff', 'feebas', 'milotic', 'castformsunny', 'castformrainy', 'staryu', 'starmie', 'kecleon', 'shuppet', 'banette', 'duskull', 'dusclops', 'tropius', 'chimecho', 'absol', 'vulpix', 'ninetales', 'pichu', 'pikachu', 'pikachucosplay', 'pikachurockstar', 'pikachubelle', 'pikachupopstar', 'pikachuphd', 'pikachulibre', 'raichu', 'psyduck', 'golduck', 'wynaut', 'wobbuffet', 'natu', 'xatu', 'girafarig', 'phanpy', 'donphan', 'pinsir', 'heracross', 'rhyhorn', 'rhydon', 'snorunt', 'glalie', 'spheal', 'sealeo', 'walrein', 'clamperl', 'huntail', 'gorebyss', 'relicanth', 'corsola', 'chinchou', 'lanturn', 'luvdisc', 'horsea', 'seadra', 'kingdra', 'bagon', 'shelgon', 'salamence', 'beldum', 'metang', 'metagross', 'regirock', 'regice', 'registeel', 'latias', 'latios', 'kyogre', 'groudon', 'rayquaza', 'jirachi', 'deoxys', 'deoxysattack', 'deoxysdefense', 'deoxysspeed'];

		var typeCount = {};
		var typeComboCount = {};
		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var megaCount = 0;

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			var tier = template.tier;
			switch (tier) {
			case 'LC':
			case 'LC Uber':
			case 'NFE':
				if (puCount > 1) continue;
				break;
			case 'PU':
				// PUs are limited to 2 but have a 20% chance of being added anyway.
				if (puCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'Uber':
				// Ubers are limited to 2 but have a 20% chance of being added anyway.
				if (uberCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(18) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Pumpkaboo':
				if (this.random(4) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Castform':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Cosplay Pikachu formes have 20% the normal rate (1/30 the normal rate each)
				if (template.species !== 'Pikachu' && this.random(30) >= 1) continue;
			}

			// Limit 2 of any type
			var types = template.types;
			var skip = false;
			for (var t = 0; t < types.length; t++) {
				if (typeCount[types[t]] > 1 && this.random(5) >= 1) {
					skip = true;
					break;
				}
			}
			if (skip) continue;

			var set = this.randomSet(template, pokemon.length, megaCount);

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit 1 of any type combination
			var typeCombo = types.join();
			if (set.ability === 'Drought' || set.ability === 'Drizzle') {
				// Drought and Drizzle don't count towards the type combo limit
				typeCombo = set.ability;
			}
			if (typeCombo in typeComboCount) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment type counters
			for (var t = 0; t < types.length; t++) {
				if (types[t] in typeCount) {
					typeCount[types[t]]++;
				} else {
					typeCount[types[t]] = 1;
				}
			}
			typeComboCount[typeCombo] = 1;

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU' || tier === 'LC' || tier === 'LC Uber' || tier === 'NFE') {
				puCount++;
			}

			// Increment mega and base species counters
			if (isMegaSet) megaCount++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	},
	randomHoennWeatherTeam: function (side) {
		var pokemonLeft = 0;
		var dice = this.random(100);
		if (dice < 40) {
			lead = 'groudon';
		} else if (dice < 80) {
			lead = 'kyogre';
		} else {
			lead = 'rayquaza';
		}
		var pokemon = [this.randomSet(this.getTemplate(lead), 0)];

		var groudonPool = ['torchic', 'combusken', 'blaziken', 'nincada', 'geodude', 'graveler', 'golem', 'nosepass', 'probopass', 'mawile', 'aron', 'lairon', 'aggron', 'numel', 'camerupt', 'slugma', 'magcargo', 'torkoal', 'sandshrew', 'sandslash', 'skarmory', 'trapinch', 'vibrava', 'flygon', 'lunatone', 'solrock', 'baltoy', 'claydol', 'anorith', 'armaldo', 'castformsunny', 'vulpix', 'ninetales', 'phanpy', 'dolphan', 'rhyhorn', 'rhydon', 'rhyperior', 'beldum', 'metang', 'metagross', 'regirock', 'registeel', 'jirachi'];
		var kyogrePool = ['mudkip', 'marshtomp', 'swampert', 'lotad', 'lombre', 'ludicolo', 'wingull', 'pelipper', 'surskit', 'masquerain', 'goldeen', 'seaking', 'magikarp', 'gyarados', 'marill', 'azumarill', 'tentacool', 'tentacruel', 'carvanha', 'sharpedo', 'wailmer', 'wailord', 'barboach', 'whiscash', 'corphish', 'crawdaunt', 'lileep', 'cradily', 'feebas', 'milotic', 'castformrainy', 'staryu', 'starmie', 'psyduck', 'golduck', 'snorunt', 'glalie', 'spheal', 'sealeo', 'walrein', 'clamperl', 'huntail', 'gorebyss', 'relicanth', 'corsola', 'chinchou', 'lanturn', 'luvdisc', 'horsea', 'seadra', 'kingdra', 'regice'];
		var rayquazaPool = ['beautifly', 'taillow', 'swellow', 'ninjask', 'zubat', 'golbat', 'crobat', 'electrike', 'manectric', 'plusle', 'minun', 'magnemite', 'magneton', 'magnezone', 'voltorb', 'electrode', 'doduo', 'dodrio', 'swablu', 'altaria', 'tropius', 'pichu', 'pikachu', 'pikachucosplay', 'pikachurockstar', 'pikachubelle', 'pikachupopstar', 'pikachuphd', 'pikachulibre', 'raichu', 'natu', 'xatu', 'bagon', 'shelgon', 'salamence', 'latias', 'latios'];

		if (lead === 'groudon') {
			pokemonPool = groudonPool;
		} else if (lead === 'kyogre') {
			pokemonPool = kyogrePool;
		} else {
			pokemonPool = rayquazaPool;
		}

		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var megaCount = 0;

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			var tier = template.tier;
			switch (tier) {
			case 'LC':
			case 'LC Uber':
			case 'NFE':
				if (puCount > 1) continue;
				break;
			case 'PU':
				// PUs are limited to 2 but have a 20% chance of being added anyway.
				if (puCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'Uber':
				// Ubers are limited to 2 but have a 20% chance of being added anyway.
				if (uberCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(18) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Pumpkaboo':
				if (this.random(4) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Castform':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Cosplay Pikachu formes have 20% the normal rate (1/30 the normal rate each)
				if (template.species !== 'Pikachu' && this.random(30) >= 1) continue;
			}

			var set = this.randomSet(template, pokemon.length, megaCount);

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU' || tier === 'LC' || tier === 'LC Uber' || tier === 'NFE') {
				puCount++;
			}

			// Increment mega and base species counters
			if (isMegaSet) megaCount++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	},
	randomSmashBrosTeam: function (side) {
		var pokemonLeft = 0;
		var dice = this.random(8);
		if (dice < 1) {
			lead = 'pikachu';
		} else if (dice < 2) {
			lead = 'jigglypuff';
		} else if (dice < 3) {
			lead = 'mewtwo';
		} else if (dice < 4) {
			lead = 'charizard';
		} else if (dice < 5) {
			lead = 'ivysaur';
		} else if (dice < 6) {
			lead = 'squirtle';
		} else if (dice < 7) {
			lead = 'lucario';
		} else {
			lead = 'greninja';
		}
		var pokemon = [this.randomSet(this.getTemplate(lead), 0)];

		var pokemonPool = ['beedrill', 'blastoise', 'chansey', 'charizard', 'clefairy', 'goldeen', 'hitmonlee', 'koffing', 'meowth', 'mew', 'onix', 'snorlax', 'starmie', 'charmander', 'electrode', 'venusaur', 'porygon', 'articuno', 'bellossom', 'celebi', 'chikorita', 'clefairy', 'cyndaquil', 'entei', 'hooh', 'lugia', 'marill', 'moltres', 'porygon2', 'raikou', 'scizor', 'staryu', 'suicune', 'togepi', 'unown', 'weezing', 'wobbuffet', 'zapdos', 'groudon', 'deoxys', 'munchlax', 'piplup', 'bonsly', 'gardevoir', 'kyogre', 'torchic', 'metagross', 'manaphy', 'abomasnow', 'chespin', 'darkrai', 'dedenne', 'eevee', 'fennekin', 'fletchling', 'genesect', 'giratina', 'gogoat', 'inkay', 'keldeo', 'kyurem', 'latias', 'latios', 'meloetta', 'oshawott', 'palkia', 'snivy', 'spewpa', 'swirlix', 'victini', 'xerneas', 'zoroark'];

		var typeCount = {};
		var typeComboCount = {};
		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var megaCount = 0;

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			var tier = template.tier;
			switch (tier) {
			case 'LC':
			case 'LC Uber':
			case 'NFE':
				if (puCount > 1) continue;
				break;
			case 'PU':
				// PUs are limited to 2 but have a 20% chance of being added anyway.
				if (puCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'Uber':
				// Ubers are limited to 2 but have a 20% chance of being added anyway.
				if (uberCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(18) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Pumpkaboo':
				if (this.random(4) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Castform':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Cosplay Pikachu formes have 20% the normal rate (1/30 the normal rate each)
				if (template.species !== 'Pikachu' && this.random(30) >= 1) continue;
			}

			// Limit 2 of any type
			var types = template.types;
			var skip = false;
			for (var t = 0; t < types.length; t++) {
				if (typeCount[types[t]] > 1 && this.random(5) >= 1) {
					skip = true;
					break;
				}
			}
			if (skip) continue;

			var set = this.randomSet(template, pokemon.length, megaCount);

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit 1 of any type combination
			var typeCombo = types.join();
			if (set.ability === 'Drought' || set.ability === 'Drizzle') {
				// Drought and Drizzle don't count towards the type combo limit
				typeCombo = set.ability;
			}
			if (typeCombo in typeComboCount) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment type counters
			for (var t = 0; t < types.length; t++) {
				if (types[t] in typeCount) {
					typeCount[types[t]]++;
				} else {
					typeCount[types[t]] = 1;
				}
			}
			typeComboCount[typeCombo] = 1;

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU' || tier === 'LC' || tier === 'LC Uber' || tier === 'NFE') {
				puCount++;
			}

			// Increment mega and base species counters
			if (isMegaSet) megaCount++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	},
	randomSeasonalWWTeam: function(side) {
		var seasonalPokemonList = ['raichu', 'nidoqueen', 'nidoking', 'clefable', 'wigglytuff', 'rapidash', 'dewgong', 'cloyster', 'exeggutor', 'starmie', 'jynx', 'lapras', 'snorlax', 'articuno', 'azumarill', 'granbull', 'delibird', 'stantler', 'miltank', 'blissey', 'swalot', 'lunatone', 'castform', 'chimecho', 'glalie', 'walrein', 'regice', 'jirachi', 'bronzong', 'chatot', 'abomasnow', 'weavile', 'togekiss', 'glaceon', 'probopass', 'froslass', 'rotom-frost', 'uxie', 'mesprit', 'azelf', 'victini', 'vanilluxe', 'sawsbuck', 'beartic', 'cryogonal', 'chandelure'];

		var shouldHavePresent = {raichu:1,clefable:1,wigglytuff:1,azumarill:1,granbull:1,miltank:1,blissey:1,togekiss:1,delibird:1};

		seasonalPokemonList = seasonalPokemonList.randomize();

		var team = [];

		for (var i=0; i<6; i++) {
			var template = this.getTemplate(seasonalPokemonList[i]);

			// we're gonna modify the default template
			template = Object.clone(template, true);
			delete template.randomBattleMoves.ironhead;
			delete template.randomBattleMoves.fireblast;
			delete template.randomBattleMoves.overheat;
			delete template.randomBattleMoves.vcreate;
			delete template.randomBattleMoves.blueflare;
			if (template.id === 'chandelure') {
				template.randomBattleMoves.flameburst = 1;
				template.abilities.DW = 'Flash Fire';
			}

			var set = this.randomSet(template, i);

			if (template.id in shouldHavePresent) set.moves[0] = 'Present';

			set.level = 100;

			team.push(set);
		}

		return team;
	},
	randomFurryTeam: function (side) {
		var pokemonLeft = 0;
		var dice = this.random(100);
		var lead = (dice  < 50)? 'purrloin' : 'liepard';
		var pokemon = [this.randomSet(this.getTemplate(lead), 0)];

		var pokemonPool = [];
		for (var id in this.data.FormatsData) {
			var template = this.getTemplate(id);
			if (!template.isMega && !template.isPrimal && !template.isNonstandard && template.randomBattleMoves) {
				pokemonPool.push(id);
			}
		}

		var typeCount = {};
		var typeComboCount = {};
		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var megaCount = 0;

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			var tier = template.tier;
			switch (tier) {
			case 'LC':
			case 'LC Uber':
			case 'NFE':
				if (puCount > 1) continue;
				break;
			case 'PU':
				// PUs are limited to 2 but have a 20% chance of being added anyway.
				if (puCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'Uber':
				// Ubers are limited to 2 but have a 20% chance of being added anyway.
				if (uberCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(18) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Pumpkaboo':
				if (this.random(4) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Castform':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Cosplay Pikachu formes have 20% the normal rate (1/30 the normal rate each)
				if (template.species !== 'Pikachu' && this.random(30) >= 1) continue;
			}

			// Limit 2 of any type
			var types = template.types;
			var skip = false;
			for (var t = 0; t < types.length; t++) {
				if (typeCount[types[t]] > 1 && this.random(5) >= 1) {
					skip = true;
					break;
				}
			}
			if (skip) continue;

			var set = this.randomSet(template, pokemon.length, megaCount);

			if (template.id === 'purrloin') {
				set.item = 'Leftovers';
				set.moves = ['Foul Play', 'Swagger', 'Substitute', 'Thunder Wave'];
			} else if (template.id === 'liepard') {
				set.item = 'Leftovers';
				set.moves = ['Foul Play', 'Swagger', 'Substitute', 'Thunder Wave'];
			}

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit 1 of any type combination
			var typeCombo = types.join();
			if (set.ability === 'Drought' || set.ability === 'Drizzle') {
				// Drought and Drizzle don't count towards the type combo limit
				typeCombo = set.ability;
			}
			if (typeCombo in typeComboCount) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment type counters
			for (var t = 0; t < types.length; t++) {
				if (types[t] in typeCount) {
					typeCount[types[t]]++;
				} else {
					typeCount[types[t]] = 1;
				}
			}
			typeComboCount[typeCombo] = 1;

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU' || tier === 'LC' || tier === 'LC Uber' || tier === 'NFE') {
				puCount++;
			}

			// Increment mega and base species counters
			if (isMegaSet) megaCount++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	},
	randomMetronomeTeam: function (side) {
		var pokemonLeft = 0;
		var pokemon = [];

		var pokemonPool = [];
		for (var id in this.data.FormatsData) {
			var template = this.getTemplate(id);
			if (!template.isMega && !template.isPrimal && !template.isNonstandard && template.randomBattleMoves) {
				pokemonPool.push(id);
			}
		}

		var typeCount = {};
		var typeComboCount = {};
		var baseFormes = {};
		var uberCount = 0;
		var puCount = 0;
		var megaCount = 0;

		while (pokemonPool.length && pokemonLeft < 6) {
			var template = this.getTemplate(this.sampleNoReplace(pokemonPool));
			if (!template.exists) continue;

			// Limit to one of each species (Species Clause)
			if (baseFormes[template.baseSpecies]) continue;

			// Not available on ORAS
			if (template.species === 'Pichu-Spiky-eared') continue;

			// Ban Shedinja from Metronome Random
			if (template.species === 'Shedinja') continue;

			var tier = template.tier;
			switch (tier) {
			case 'LC':
			case 'LC Uber':
			case 'NFE':
				if (puCount > 1) continue;
				break;
			case 'PU':
				// PUs are limited to 2 but have a 20% chance of being added anyway.
				if (puCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'Uber':
				// Ubers are limited to 2 but have a 20% chance of being added anyway.
				if (uberCount > 1 && this.random(5) >= 1) continue;
				break;
			case 'CAP':
				// CAPs have 20% the normal rate
				if (this.random(5) >= 1) continue;
				break;
			case 'Unreleased':
				// Unreleased Pokémon have 20% the normal rate
				if (this.random(5) >= 1) continue;
			}

			// Adjust rate for species with multiple formes
			switch (template.baseSpecies) {
			case 'Arceus':
				if (this.random(18) >= 1) continue;
				break;
			case 'Basculin':
				if (this.random(2) >= 1) continue;
				break;
			case 'Genesect':
				if (this.random(5) >= 1) continue;
				break;
			case 'Pumpkaboo':
				if (this.random(4) >= 1) continue;
				break;
			case 'Gourgeist':
				if (this.random(4) >= 1) continue;
				break;
			case 'Meloetta':
				if (this.random(2) >= 1) continue;
				break;
			case 'Castform':
				if (this.random(2) >= 1) continue;
				break;
			case 'Pikachu':
				// Cosplay Pikachu formes have 20% the normal rate (1/30 the normal rate each)
				if (template.species !== 'Pikachu' && this.random(30) >= 1) continue;
			}

			// Limit 2 of any type
			var types = template.types;
			var skip = false;
			for (var t = 0; t < types.length; t++) {
				if (typeCount[types[t]] > 1 && this.random(5) >= 1) {
					skip = true;
					break;
				}
			}
			if (skip) continue;

			var set = this.randomSet(template, pokemon.length, megaCount);

			set.moves = ['Metronome'];

			if (['Assault Vest'].indexOf(set.item) > -1) {
				set.item = 'Leftovers';
			}

			// Illusion shouldn't be on the last pokemon of the team
			if (set.ability === 'Illusion' && pokemonLeft > 4) continue;

			// Limit 1 of any type combination
			var typeCombo = types.join();
			if (set.ability === 'Drought' || set.ability === 'Drizzle') {
				// Drought and Drizzle don't count towards the type combo limit
				typeCombo = set.ability;
			}
			if (typeCombo in typeComboCount) continue;

			// Limit the number of Megas to one
			var forme = template.otherFormes && this.getTemplate(template.otherFormes[0]);
			var isMegaSet = this.getItem(set.item).megaStone || (forme && forme.isMega && forme.requiredMove && set.moves.indexOf(toId(forme.requiredMove)) >= 0);
			if (isMegaSet && megaCount > 0) continue;

			// Okay, the set passes, add it to our team
			pokemon.push(set);

			// Now that our Pokemon has passed all checks, we can increment our counters
			pokemonLeft++;

			// Increment type counters
			for (var t = 0; t < types.length; t++) {
				if (types[t] in typeCount) {
					typeCount[types[t]]++;
				} else {
					typeCount[types[t]] = 1;
				}
			}
			typeComboCount[typeCombo] = 1;

			// Increment Uber/NU counters
			if (tier === 'Uber') {
				uberCount++;
			} else if (tier === 'PU' || tier === 'LC' || tier === 'LC Uber' || tier === 'NFE') {
				puCount++;
			}

			// Increment mega and base species counters
			if (isMegaSet) megaCount++;
			baseFormes[template.baseSpecies] = 1;
		}
		return pokemon;
	}
};
